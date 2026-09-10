import { useState, useEffect, useCallback, useRef } from 'react';
import type { PropertyDescriptor } from '@/constants/propertyDescriptors';
import {
  readStyleValue,
  writeStyleValue,
  parseNumberValue,
  formatNumberValue,
} from '@/utils/styleProperties';

export interface UsePropertyValuesResult {
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  setNumberValue: (key: string, num: number) => void;
  getNumber: (key: string) => number;
  mixedKeys: Set<string>;
  refresh: () => void;
}

export function usePropertyValues(
  selectedElements: HTMLElement[],
  descriptors: PropertyDescriptor[],
  onChange?: () => void,
): UsePropertyValuesResult {
  const [values, setValues] = useState<Record<string, string>>({});
  const [mixedKeys, setMixedKeys] = useState<Set<string>>(new Set());
  const descriptorsRef = useRef(descriptors);
  const onChangeRef = useRef(onChange);

  descriptorsRef.current = descriptors;
  onChangeRef.current = onChange;

  const readValues = useCallback(() => {
    if (!selectedElements || selectedElements.length === 0) {
      setValues({});
      setMixedKeys(new Set());
      return;
    }

    const newValues: Record<string, string> = {};
    const newMixed = new Set<string>();

    for (const descriptor of descriptorsRef.current) {
      const key = descriptor.key;
      const firstValue = readStyleValue(selectedElements[0], key);
      let isMixed = false;

      for (let i = 1; i < selectedElements.length; i++) {
        const elValue = readStyleValue(selectedElements[i], key);
        if (elValue !== firstValue) {
          isMixed = true;
          break;
        }
      }

      if (isMixed) {
        newMixed.add(key);
        newValues[key] = '';
      } else {
        newValues[key] = firstValue;
      }
    }

    setValues(newValues);
    setMixedKeys(newMixed);
  }, [selectedElements]);

  useEffect(() => {
    readValues();
  }, [readValues]);

  const setValue = useCallback(
    (key: string, value: string) => {
      if (!selectedElements || selectedElements.length === 0) return;

      selectedElements.forEach((el) => {
        writeStyleValue(el, key, value);
      });

      setValues((prev) => ({ ...prev, [key]: value }));
      setMixedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      onChangeRef.current?.();
    },
    [selectedElements],
  );

  const setNumberValue = useCallback(
    (key: string, num: number) => {
      const descriptor = descriptorsRef.current.find((d) => d.key === key);
      const unit = descriptor?.unit ?? 'px';
      const formatted = formatNumberValue(num, unit);
      setValue(key, formatted);
    },
    [setValue],
  );

  const getNumber = useCallback(
    (key: string): number => {
      const raw = values[key];
      if (!raw) return 0;
      const descriptor = descriptorsRef.current.find((d) => d.key === key);
      return parseNumberValue(raw, descriptor?.unit ?? 'px');
    },
    [values],
  );

  return {
    values,
    setValue,
    setNumberValue,
    getNumber,
    mixedKeys,
    refresh: readValues,
  };
}
