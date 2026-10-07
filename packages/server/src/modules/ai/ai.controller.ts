import { Body, Controller, Post } from '@nestjs/common';
import type { Presentation } from '@noppt/core';
import type { DesignProposal, PresentationPlan, RenderedSlide } from '@noppt/ai';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';
import type {
  AssembleImagesRequest,
  DesignProposalsRequest,
  EditElementRequest,
  EditGlobalRequest,
  EditSlideRequest,
  FinalizeRequest,
  GenerateFromPlanRequest,
  GeneratePresentationRequest,
  PlanPresentationRequest,
  RegenerateSlideRequest,
  RenderSlidesRequest,
} from './ai.service';

@Controller('ai')
export class AiController {
  @Post('generate')
  generatePresentation(
    @Body() req: GeneratePresentationRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ aiService }) => aiService.generatePresentation(req));
  }

  @Post('plan')
  planPresentation(
    @Body() req: PlanPresentationRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<PresentationPlan> {
    return withRestContext(auth, ({ aiService }) => aiService.planPresentation(req));
  }

  @Post('generate-from-plan')
  generateFromPlan(
    @Body() req: GenerateFromPlanRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ aiService }) => aiService.generateFromPlan(req));
  }

  @Post('design-proposals')
  generateDesignProposals(
    @Body() req: DesignProposalsRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<DesignProposal[]> {
    return withRestContext(auth, ({ aiService }) => aiService.generateDesignProposals(req));
  }

  @Post('render-slides')
  renderSlides(
    @Body() req: RenderSlidesRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<RenderedSlide[]> {
    return withRestContext(auth, ({ aiService }) => aiService.renderSlides(req));
  }

  @Post('regenerate-slide')
  regenerateSlide(
    @Body() req: RegenerateSlideRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<RenderedSlide> {
    return withRestContext(auth, ({ aiService }) => aiService.regenerateSlide(req));
  }

  @Post('assemble-images')
  assembleImages(
    @Body() req: AssembleImagesRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<RenderedSlide[]> {
    return withRestContext(auth, ({ aiService }) => aiService.assembleImages(req));
  }

  @Post('finalize')
  finalizePresentation(
    @Body() req: FinalizeRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ aiService }) => aiService.finalizePresentation(req));
  }

  @Post('edit-slide')
  editSlide(
    @Body() req: EditSlideRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<{ html: string }> {
    return withRestContext(auth, ({ aiService }) => aiService.editSlide(req));
  }

  @Post('edit-element')
  editElement(
    @Body() req: EditElementRequest,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<{ html: string }> {
    return withRestContext(auth, ({ aiService }) => aiService.editElement(req));
  }

  @Post('edit-global')
  editGlobal(@Body() req: EditGlobalRequest, @CurrentAuth() auth?: McpAuth): Promise<unknown> {
    return withRestContext(auth, ({ aiService }) => aiService.editGlobal(req));
  }
}
