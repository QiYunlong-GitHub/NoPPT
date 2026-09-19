/**
 * PropertyPanel 的受控输入子组件（由 PropertyPanel.tsx 逐字节搬移）。
 * - DescriptorNumberInput：带 stepper 的数值输入
 * - DescriptorColorInput：取色器输入
 */
import { Minus, Plus } from 'lucide-react';
import { t } from '@/i18n';
import type { PropertyDescriptor } from '@/constants/propertyDescriptors';
import { parseNumberValue, formatNumberValue } from '@/utils/styleProperties';
import { rgbToHex } from './format';

interface DescriptorNumberInputProps {
  descriptor: PropertyDescriptor;
  value: string;
  mixed?: boolean;
  onValueChange: (value: string) => void;
  onNumberChange?: (num: number) => void;
  onAdjust?: (delta: number) => void;
  showSteppers?: boolean;
  inputClassName?: string;
}
export function DescriptorNumberInput({
  descriptor,
  value,
  mixed,
  onValueChange,
  onNumberChange,
  onAdjust,
  showSteppers,
  inputClassName,
}: DescriptorNumberInputProps) {
  const numVal = value ? parseNumberValue(value, descriptor.unit || 'px') : 0;
  const display = mixed ? '' : value ? String(numVal) : '';
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    const clamped = descriptor.min !== undefined && val < descriptor.min ? descriptor.min : val;
    const final =
      descriptor.max !== undefined && clamped > descriptor.max ? descriptor.max : clamped;
    if (onNumberChange) {
      onNumberChange(final);
    } else {
      onValueChange(formatNumberValue(final, descriptor.unit || 'px'));
    }
  };
  return (
    <div className="flex items-center gap-2">
      {showSteppers && (
        <button
          onClick={() => onAdjust?.(-(descriptor.step || 1))}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Minus className="w-4 h-4 text-slate-600" />
        </button>
      )}
      <input
        type="number"
        value={display}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        placeholder={mixed ? t('混合') : undefined}
        className={
          inputClassName ||
          'flex-1 text-center text-sm text-slate-700 font-medium px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-blue-500'
        }
      />
      {descriptor.unit && <span className="text-xs text-slate-400 w-6">{descriptor.unit}</span>}
      {showSteppers && (
        <button
          onClick={() => onAdjust?.(descriptor.step || 1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-slate-600" />
        </button>
      )}
    </div>
  );
}
interface DescriptorColorInputProps {
  descriptor: PropertyDescriptor;
  value: string;
  mixed?: boolean;
  onValueChange: (value: string) => void;
}
export function DescriptorColorInput({
  descriptor,
  value,
  mixed,
  onValueChange,
}: DescriptorColorInputProps) {
  const hex = value ? rgbToHex(value) : rgbToHex(String(descriptor.defaultValue || '#000000'));
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200"
      />
      <span className="text-xs text-slate-500 font-mono">{mixed ? t('混合') : hex}</span>
    </div>
  );
}
