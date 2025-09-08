import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FeishuModule } from './feishu/feishu.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // makes the config module global, so no need to import in other modules
      envFilePath: '.env', // specify the path to your .env file
    }),
    FeishuModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
