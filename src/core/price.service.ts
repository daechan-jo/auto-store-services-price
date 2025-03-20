// import { CronType } from '@daechanjo/models';
// import { UtilService } from '@daechanjo/util';
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
//
// @Injectable()
// export class PriceService {
//   constructor(
//     private readonly configService: ConfigService,
//     private readonly utilService: UtilService,
//   ) {}
//
//   async autoPriceCron(cronId?: string, retryCount = 0) {
//     const lockKey = `lock:${this.configService.get<string>('STORE')}:price`;
//     const currentCronId = cronId || this.utilService.generateCronId();
//
//     const isLocked = await this.redis.set(lockKey, Date.now().toString(), 'NX');
//
//     if (!isLocked) {
//       console.log(`${CronType.PRICE}${currentCronId}: 락 획득 실패`);
//       return;
//     }
//
//     try {
//       console.log(`${CronType.PRICE}${currentCronId}: 시작`);
//
//       await this.init(currentCronId);
//     } catch (error: any) {
//       console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 오류 발생\n`, error);
//       if (retryCount < 3) {
//         console.log(`${CronType.PRICE}${currentCronId}: ${retryCount + 1}번째 재시도 예정`);
//         setTimeout(() => this.autoPriceCron(cronId, retryCount + 1), 3000);
//       } else {
//         await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
//           cronType: CronType.PRICE,
//           store: this.configService.get<string>('STORE'),
//           cronId: currentCronId,
//           message: error.message,
//         });
//         console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 재시도 횟수 초과`);
//       }
//     } finally {
//       await this.redis.del(lockKey);
//       console.log(`${CronType.PRICE}${currentCronId}: 종료`);
//     }
//   }
// }
