import { Controller, Get, HttpCode } from '@nestjs/common';
import { FeishuService } from './feishu.service';

@Controller('feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  @Get()
  @HttpCode(200)
  getHello(): string {
    return 'Feishu module is active and ready.';
  }
}
