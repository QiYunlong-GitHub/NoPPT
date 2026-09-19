import { t } from '@/i18n';
import {
  ClipboardList,
  FileCode2,
  Edit,
  ShieldCheck,
  Eye,
  type LucideIcon,
} from 'lucide-react';

export interface RoutingStage {
  key: 'planning' | 'content' | 'editing' | 'audit' | 'auditVlm';
  name: string;
  desc: string;
  icon: LucideIcon;
  recommendation: string;
  tip: string;
}

// 从 AIModelSettings 外置（Phase 6 抽取，零行为变更）。
// 原组件为每次渲染重建该数组（会重新调用 t），此处用函数返回以保证 locale 变更时同步刷新。
export function getRoutingStages(): RoutingStage[] {
  return [
    {
      key: 'planning' as const,
      name: '大纲规划',
      desc: t('生成演示文稿结构规划（标题、页数、每页类型、要点）'),
      icon: ClipboardList,
      recommendation: '推荐使用推理能力强的模型（如GPT-4/Claude/DeepSeek-R1），规划质量更高',
      tip: '此阶段需要模型理解主题、分析逻辑结构、输出结构化JSON。强推理模型能生成更合理的内容大纲和页面类型分配。',
    },
    {
      key: 'content' as const,
      name: 'HTML内容生成',
      desc: t('逐页生成幻灯片HTML代码'),
      icon: FileCode2,
      recommendation: '推荐使用响应快速的模型（如GPT-4o-mini），并发生成时速度优势明显',
      tip: '此阶段需要模型严格遵循HTML规范和8pt网格系统，精确生成页面样式。并发生成3页，快速模型可显著缩短等待时间。',
    },
    {
      key: 'editing' as const,
      name: '对话编辑',
      desc: t('对话中修改单页或全局内容'),
      icon: Edit,
      recommendation: '推荐使用平衡型模型，兼顾理解能力和响应速度',
      tip: '此阶段需要模型理解用户的自然语言修改指令，精准修改现有HTML内容，同时保持整体风格一致。',
    },
    {
      key: 'audit' as const,
      name: '审核文本评审 (LLM)',
      desc: t('逐页评审幻灯片HTML的内容逻辑、层次与完成度'),
      icon: ShieldCheck,
      recommendation: '推荐使用指令遵循能力强的模型（如GPT-4o/Claude），评审更准确',
      tip: '生成结束后，审核机制将调用该模型逐页读取HTML源码，从哲学一致性、视觉层级、细节执行、功能性、创新性五个维度打分并给出问题。可在「审核设置」中开关。',
    },
    {
      key: 'auditVlm' as const,
      name: '审核视觉评审 (VLM)',
      desc: t('逐页查看渲染截图进行视觉设计评审'),
      icon: Eye,
      recommendation: '必须使用支持图片输入的多模态模型（如GPT-4o、Claude 3.5、Qwen-VL）',
      tip: '生成结束后，审核机制将把每页的渲染截图发送给该视觉大模型，基于真实渲染效果评审对齐、留白、色彩与专业完成度。请务必选择支持图片理解的多模态模型，否则会报错并被跳过。',
    },
  ];
}
