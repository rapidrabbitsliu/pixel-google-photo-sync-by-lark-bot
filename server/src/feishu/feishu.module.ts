import { Module } from '@nestjs/common';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [FeishuController],
  providers: [FeishuService],
})
export class FeishuModule {}
