import { Test, TestingModule } from '@nestjs/testing';
import { FeishuController } from './feishu.controller';

describe('FeishuController', () => {
  let controller: FeishuController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeishuController],
    }).compile();

    controller = module.get<FeishuController>(FeishuController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
