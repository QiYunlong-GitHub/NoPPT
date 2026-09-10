import { Module } from '@nestjs/common';
import { McpViewController } from './mcp-view.controller';

@Module({
  controllers: [McpViewController],
})
export class McpViewModule {}
