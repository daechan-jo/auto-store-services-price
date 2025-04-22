import { JobType } from '@daechanjo/models';
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

  async initCoupangPriceControl(jobId?: string, retryCount = 0) {
    const lockKey = `lock:${this.configService.get<string>('STORE')}:coupang:price`;
    const currentJobId = jobId || this.utilService.generateCronId();

    const isLocked = await this.redis.set(lockKey, Date.now().toString(), 'NX');

    if (!isLocked) {
      console.log(`${JobType.PRICE}${currentJobId}: 락 획득 실패`);
      return;
    }

    try {
      console.log(`${JobType.PRICE}${currentJobId}: 시작`);

      await this.priceCoupangService.coupangPriceControl(currentJobId);
    } catch (error: any) {
      console.error(`${JobType.ERROR}${JobType.PRICE}${currentJobId}: 오류 발생\n`, error);
      if (retryCount < 3) {
        console.log(`${JobType.PRICE}${currentJobId}: ${retryCount + 1}번째 재시도 예정`);
        setTimeout(() => this.initCoupangPriceControl(currentJobId, retryCount + 1), 3000);
      } else {
        await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
          jobId: currentJobId,
          jobType: JobType.PRICE,
          jobName: 'Price-service',
          message: error,
        });
        console.error(`${JobType.ERROR}${JobType.PRICE}${currentJobId}: 재시도 횟수 초과`);
      }
    } finally {
      await this.redis.del(lockKey);
      console.log(`${JobType.PRICE}${currentJobId}: 종료`);

      const hoursInMs = 3 * 60 * 60 * 1000;
      const nextRunTime = new Date(Date.now() + hoursInMs);
      console.log(`${JobType.PRICE}: 다음 실행 예약됨 - ${nextRunTime}`);

      setTimeout(() => {
        console.log(`${JobType.PRICE}: 예약된 실행 시작`);
        this.initCoupangPriceControl();
      }, hoursInMs);
    }
  }
}
