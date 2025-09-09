import { Module } from '@nestjs/common';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { ConfigModule } from '@nestjs/config';
import { FileService } from 'src/file/file.service';

@Module({
  imports: [ConfigModule],
  controllers: [FeishuController],
  providers: [FeishuService, FileService],
})
export class FeishuModule {}
