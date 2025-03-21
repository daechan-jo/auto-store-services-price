import { CronType } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { PriceCoupangService } from './price.coupang.service';

@Injectable()
export class PriceService {
  constructor(
    private readonly configService: ConfigService,
    private readonly utilService: UtilService,
    private readonly priceCoupangService: PriceCoupangService,
    private readonly rabbitmqService: RabbitMQService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async initCoupangPriceControl(cronId?: string, retryCount = 0) {
    const lockKey = `lock:${this.configService.get<string>('STORE')}:coupang:price`;
    const currentCronId = cronId || this.utilService.generateCronId();

    const isLocked = await this.redis.set(lockKey, Date.now().toString(), 'NX');

    if (!isLocked) {
      console.log(`${CronType.PRICE}${currentCronId}: 락 획득 실패`);
      return;
    }

    try {
      console.log(`${CronType.PRICE}${currentCronId}: 시작`);

      await this.priceCoupangService.coupangPriceControl(currentCronId);
    } catch (error: any) {
      console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 오류 발생\n`, error);
      if (retryCount < 3) {
        console.log(`${CronType.PRICE}${currentCronId}: ${retryCount + 1}번째 재시도 예정`);
        setTimeout(() => this.initCoupangPriceControl(cronId, retryCount + 1), 3000);
      } else {
        await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
          cronType: CronType.PRICE,
          store: this.configService.get<string>('STORE'),
          cronId: currentCronId,
          message: error.message,
        });
        console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 재시도 횟수 초과`);
      }
    } finally {
      await this.redis.del(lockKey);
      console.log(`${CronType.PRICE}${currentCronId}: 종료`);

      // 함수 완료 후 3시간 후에 다시 실행
      const threeHoursInMs = 3 * 60 * 60 * 1000;
      const nextRunTime = new Date(Date.now() + threeHoursInMs);
      console.log(`${CronType.PRICE}: 다음 실행 예약됨 - ${nextRunTime}`);

      setTimeout(() => {
        console.log(`${CronType.PRICE}: 예약된 실행 시작`);
        this.initCoupangPriceControl();
      }, threeHoursInMs);
    }
  }
}
