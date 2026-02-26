import React, { useRef, useEffect } from 'react';
// @ts-ignore – plotly.js-finance-dist-min has no TS declarations
import Plotly from 'plotly.js-finance-dist-min';

interface PlotProps {
  data: any[];
  layout?: any;
  config?: any;
  style?: React.CSSProperties;
  onInitialized?: (figure: any, graphDiv: HTMLElement) => void;
  onUpdate?: (figure: any, graphDiv: HTMLElement) => void;
}

const DEBOUNCE_MS = 100;

const PlotComponent: React.FC<PlotProps> = ({
  data,
  layout,
  config,
  style,
  onInitialized,
  onUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !data) return;

    const mergedLayout = { ...(layout || {}) };
    const mergedConfig = { responsive: true, ...(config || {}) };

    if (!initializedRef.current) {
      Plotly.newPlot(el, data, mergedLayout, mergedConfig).then(() => {
        initializedRef.current = true;
        if (onInitialized) onInitialized({ data, layout: mergedLayout }, el);
      });
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        Plotly.react(el, data, mergedLayout, mergedConfig).then(() => {
          if (onUpdate) onUpdate({ data, layout: mergedLayout }, el);
        });
      }, DEBOUNCE_MS);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [data, layout, config]);

  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el) {
        try {
          Plotly.purge(el);
        } catch (_) {
          // ignore cleanup errors
        }
      }
      initializedRef.current = false;
    };
  }, []);

  return React.createElement('div', { ref: containerRef, style });
};

PlotComponent.displayName = 'Plot';

export const Plot = PlotComponent;
export default Plotly;
