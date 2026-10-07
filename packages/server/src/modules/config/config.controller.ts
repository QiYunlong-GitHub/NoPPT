import { Controller, Get, Post, Put, Body } from '@nestjs/common';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { assertDefaultRestConfig } from '../../common/rest-context';
// Nest runtime metadata requires ConfigService as a value import for constructor injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from './config.service';
import type { AppConfig, PublicAppConfig } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  async getConfig(@CurrentAuth() auth?: McpAuth): Promise<PublicAppConfig> {
    assertDefaultRestConfig(auth);
    return this.configService.getPublicConfig();
  }

  @Put()
  async saveConfig(
    @Body() config: Partial<AppConfig>,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<PublicAppConfig> {
    assertDefaultRestConfig(auth);
    return this.configService.toPublicConfig(await this.configService.saveConfig(config));
  }

  @Post('reset')
  async resetConfig(@CurrentAuth() auth?: McpAuth): Promise<PublicAppConfig> {
    assertDefaultRestConfig(auth);
    return this.configService.toPublicConfig(await this.configService.resetConfig());
  }
}
