import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { ConfigService, AppConfig } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  async getConfig(): Promise<AppConfig> {
    return this.configService.getConfig();
  }

  @Put()
  async saveConfig(@Body() config: Partial<AppConfig>): Promise<AppConfig> {
    return this.configService.saveConfig(config);
  }

  @Post('reset')
  async resetConfig(): Promise<AppConfig> {
    return this.configService.resetConfig();
  }
}
