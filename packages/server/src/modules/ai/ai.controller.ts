import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import type { Presentation } from '@noppt/core';
import type { PresentationPlan, DesignProposal, RenderedSlide } from '@noppt/ai';
import {
  AiService,
  GeneratePresentationRequest,
  PlanPresentationRequest,
  GenerateFromPlanRequest,
  DesignProposalsRequest,
  RenderSlidesRequest,
  RegenerateSlideRequest,
  AssembleImagesRequest,
  FinalizeRequest,
  EditSlideRequest,
  EditElementRequest,
  EditGlobalRequest,
} from './ai.service';
import { LogsService } from '../logs/logs.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { getStorageService } from '../../common/storage.service';

@Controller('ai')
export class AiController {
  private readonly aiService: AiService;

  constructor() {
    const storage = getStorageService();
    const logsService = new LogsService(storage);
    const configService = new ConfigService(storage);
    const auditService = new AuditService(storage, configService, logsService);
    this.aiService = new AiService(storage, logsService, auditService, configService);
  }

  @Post('generate')
  async generatePresentation(@Body() req: GeneratePresentationRequest): Promise<Presentation> {
    return this.aiService.generatePresentation(req);
  }

  @Post('plan')
  async planPresentation(@Body() req: PlanPresentationRequest): Promise<PresentationPlan> {
    return this.aiService.planPresentation(req);
  }

  @Post('generate-from-plan')
  async generateFromPlan(@Body() req: GenerateFromPlanRequest): Promise<Presentation> {
    return this.aiService.generateFromPlan(req);
  }

  @Post('design-proposals')
  async generateDesignProposals(@Body() req: DesignProposalsRequest): Promise<DesignProposal[]> {
    return this.aiService.generateDesignProposals(req);
  }

  @Post('render-slides')
  async renderSlides(@Body() req: RenderSlidesRequest): Promise<RenderedSlide[]> {
    return this.aiService.renderSlides(req);
  }

  @Post('regenerate-slide')
  async regenerateSlide(@Body() req: RegenerateSlideRequest): Promise<RenderedSlide> {
    return this.aiService.regenerateSlide(req);
  }

  @Post('assemble-images')
  async assembleImages(@Body() req: AssembleImagesRequest): Promise<RenderedSlide[]> {
    return this.aiService.assembleImages(req);
  }

  @Post('finalize')
  async finalizePresentation(@Body() req: FinalizeRequest): Promise<Presentation> {
    return this.aiService.finalizePresentation(req);
  }

  @Post('edit-slide')
  async editSlide(@Body() req: EditSlideRequest): Promise<{ html: string }> {
    return this.aiService.editSlide(req);
  }

  @Post('edit-element')
  async editElement(@Body() req: EditElementRequest): Promise<{ html: string }> {
    return this.aiService.editElement(req);
  }

  @Post('edit-global')
  async editGlobal(@Body() req: EditGlobalRequest): Promise<any> {
    return this.aiService.editGlobal(req);
  }
}
