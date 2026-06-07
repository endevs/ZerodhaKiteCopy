import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import './OptionChainBoard.css';

export interface QuoteSide {
  instrument_token?: number;
  tradingsymbol?: string;
  ltp?: number | null;
  ltp_chg?: number | null;
  ltp_chg_pct?: number | null;
  iv?: number | null;
  iv_chg?: number | null;
  iv_chg_pct?: number | null;
  oi?: number | null;
  oi_lakh?: number | null;
  oi_chg?: number | null;
}

export interface ChainRow {
  strike: number;
  ce: QuoteSide | null;
  pe: QuoteSide | null;
}

interface OptionChainTableProps {
  chain: ChainRow[];
  spot: number;
  atmStrike: number | null;
  tradingDate: string;
  onSelectContract: (
    token: number,
    symbol: string,
    strike: number,
    type: 'CE' | 'PE'
  ) => void;
  highlightStrike?: number | null;
}

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(d);

const chgClass = (v: number | null | undefined) => {
  if (v == null || v === 0) return '';
  return v > 0 ? 'chg-pos' : 'chg-neg';
};

const hasContract = (side: QuoteSide | null) =>
  !!(side?.instrument_token && side?.tradingsymbol);

const OptionChainTable: React.FC<OptionChainTableProps> = ({
  chain,
  spot,
  atmStrike,
  tradingDate,
  onSelectContract,
  highlightStrike,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);

  const maxOi = useMemo(() => {
    let m = 0;
    chain.forEach((r) => {
      if (r.ce?.oi_lakh) m = Math.max(m, r.ce.oi_lakh);
      if (r.pe?.oi_lakh) m = Math.max(m, r.pe.oi_lakh);
    });
    return m || 1;
  }, [chain]);

  const scrollToAtm = useCallback(() => {
    if (!containerRef.current || atmStrike == null) return;
    const idx = chain.findIndex((r) => r.strike === atmStrike);
    if (idx < 0) return;
    const tbody = containerRef.current.querySelector('tbody');
    const rows = tbody?.querySelectorAll('tr');
    const row = rows?.[idx] as HTMLElement | undefined;
    if (!row) return;
    const h = containerRef.current.clientHeight;
    containerRef.current.scrollTo({
      top: row.offsetTop - h / 2 + row.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [chain, atmStrike]);

  useEffect(() => {
    const t = setTimeout(scrollToAtm, 150);
    return () => clearTimeout(t);
  }, [chain, atmStrike, scrollToAtm]);

  const openChart = (side: QuoteSide | null, strike: number, type: 'CE' | 'PE') => {
    if (!side?.instrument_token || !side.tradingsymbol) return;
    if (!tradingDate) {
      alert('Please select a trading date first');
      return;
    }
    onSelectContract(side.instrument_token, side.tradingsymbol, strike, type);
  };

  const renderChartButton = (
    side: QuoteSide | null,
    strike: number,
    type: 'CE' | 'PE'
  ) => {
    if (!hasContract(side)) return null;
    const label = side?.tradingsymbol
      ? `Chart ${side.tradingsymbol}`
      : `Chart ${strike} ${type}`;
    const btnClass =
      type === 'CE'
        ? 'btn btn-sm row-chart-btn btn-outline-success'
        : 'btn btn-sm row-chart-btn btn-outline-danger';
    return (
      <button
        type="button"
        className={btnClass}
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          openChart(side, strike, type);
        }}
      >
        <i className="bi bi-graph-up" aria-hidden="true" />
        <span className="row-chart-btn-label">{type}</span>
      </button>
    );
  };

  return (
    <div ref={containerRef} className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
      <table className="table table-sm table-hover option-chain-table mb-0">
        <thead>
          <tr>
            <th colSpan={3} className="text-center text-success border-end">
              CALLS
            </th>
            <th className="text-center border-end strike-col">Strike</th>
            <th colSpan={4} className="text-center text-danger">
              PUTS
            </th>
          </tr>
          <tr>
            <th className="text-success call-side">OI (L)</th>
            <th className="text-success call-side">LTP Chg</th>
            <th className="text-success call-side border-end">LTP (Chg%)</th>
            <th className="text-center border-end strike-col">Strike</th>
            <th className="text-danger put-side">IV (Chg)</th>
            <th className="text-danger put-side">LTP (Chg%)</th>
            <th className="text-danger put-side">LTP Chg</th>
            <th className="text-danger put-side">OI (L)</th>
          </tr>
        </thead>
        <tbody onMouseLeave={() => setHoveredStrike(null)}>
          {chain.map((row) => {
            const isAtm = atmStrike != null && row.strike === atmStrike;
            const itmCe = row.strike < spot;
            const itmPe = row.strike > spot;
            const hl = highlightStrike != null && row.strike === highlightStrike;
            const isHovered = hoveredStrike === row.strike;
            return (
              <tr
                key={row.strike}
                className={`option-chain-row ${isAtm ? 'row-atm' : ''} ${hl ? 'table-info' : ''} ${isHovered ? 'row-hovered' : ''}`}
                onMouseEnter={() => setHoveredStrike(row.strike)}
              >
                <td className={`call-side ${itmCe ? 'row-itm-ce' : ''}`}>
                  {row.ce?.oi_lakh != null ? (
                    <>
                      {fmt(row.ce.oi_lakh, 2)}
                      <div className="oi-bar-wrap">
                        <div
                          className="oi-bar-ce"
                          style={{ width: `${((row.ce.oi_lakh || 0) / maxOi) * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`call-side ${chgClass(row.ce?.ltp_chg)}`}>
                  {fmt(row.ce?.ltp_chg)}
                </td>
                <td className={`call-side border-end ltp-col ${chgClass(row.ce?.ltp_chg_pct)}`}>
                  <div className="ltp-cell-inner">
                    <span className="ltp-value">
                      {row.ce?.ltp != null ? (
                        <>
                          {fmt(row.ce.ltp)} <small>({fmt(row.ce.ltp_chg_pct, 1)}%)</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                    {isHovered && renderChartButton(row.ce, row.strike, 'CE')}
                  </div>
                </td>
                <td className="text-center border-end strike-col">{row.strike}</td>
                <td className={`put-side ${chgClass(row.pe?.iv_chg)}`}>
                  {row.pe?.iv != null ? (
                    <>
                      {fmt(row.pe.iv, 1)}{' '}
                      <small>
                        ({row.pe.iv_chg != null ? `${row.pe.iv_chg >= 0 ? '+' : ''}${fmt(row.pe.iv_chg, 1)}` : '—'})
                      </small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`put-side ltp-col ${chgClass(row.pe?.ltp_chg_pct)}`}>
                  <div className="ltp-cell-inner">
                    <span className="ltp-value">
                      {row.pe?.ltp != null ? (
                        <>
                          {fmt(row.pe.ltp)} <small>({fmt(row.pe.ltp_chg_pct, 1)}%)</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                    {isHovered && renderChartButton(row.pe, row.strike, 'PE')}
                  </div>
                </td>
                <td className={`put-side ${chgClass(row.pe?.ltp_chg)}`}>
                  {fmt(row.pe?.ltp_chg)}
                </td>
                <td className={`put-side ${itmPe ? 'row-itm-pe' : ''}`}>
                  {row.pe?.oi_lakh != null ? (
                    <>
                      {fmt(row.pe.oi_lakh, 2)}
                      <div className="oi-bar-wrap">
                        <div
                          className="oi-bar-pe"
                          style={{ width: `${((row.pe.oi_lakh || 0) / maxOi) * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default OptionChainTable;
