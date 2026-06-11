import React, {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { isIvSpike, isLtpSpike } from '../lib/optionChainSpike';
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

export interface AddLegFromChainParams {
  side: 'BUY' | 'SELL';
  strike: number;
  optionType: 'CE' | 'PE';
  tradingsymbol: string;
  ltp: number;
  lots: number;
}

export interface OptionChainTableHandle {
  scrollToAtm: () => void;
}

interface OptionChainTableProps {
  chain: ChainRow[];
  spot: number;
  atmStrike: number | null;
  tradingDate: string;
  /** Changes when index/expiry/trading date change — triggers one-time ATM centering. */
  scrollContextKey: string;
  onSelectContract: (
    token: number,
    symbol: string,
    strike: number,
    type: 'CE' | 'PE'
  ) => void;
  highlightStrike?: number | null;
  defaultLots?: number;
  onAddLeg?: (params: AddLegFromChainParams) => void;
  priceSpikeThreshold: number;
  ivSpikeThreshold: number;
}

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(d);

const fmtChgPct = (v: number | null | undefined) => {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
};

const fmtChgAbs = (v: number | null | undefined, d = 2) => {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(d)}`;
};

const chgClass = (v: number | null | undefined) => {
  if (v == null || v === 0) return '';
  return v > 0 ? 'chg-pos' : 'chg-neg';
};

const ltpColClass = (pct: number | null | undefined) => {
  if (pct == null || pct === 0) return '';
  return pct > 0 ? 'ltp-col-up' : 'ltp-col-down';
};

const hasContract = (side: QuoteSide | null) =>
  !!(side?.instrument_token && side?.tradingsymbol);

interface OptionChainRowProps {
  row: ChainRow;
  spot: number;
  atmStrike: number | null;
  tradingDate: string;
  highlightStrike?: number | null;
  isHovered: boolean;
  maxOi: number;
  defaultLots: number;
  priceSpikeThreshold: number;
  ivSpikeThreshold: number;
  onMouseEnter: () => void;
  onSelectContract: OptionChainTableProps['onSelectContract'];
  onAddLeg?: OptionChainTableProps['onAddLeg'];
}

const OptionChainRow = memo(function OptionChainRow({
  row,
  spot,
  atmStrike,
  tradingDate,
  highlightStrike,
  isHovered,
  maxOi,
  defaultLots,
  priceSpikeThreshold,
  ivSpikeThreshold,
  onMouseEnter,
  onSelectContract,
  onAddLeg,
}: OptionChainRowProps) {
  const prevCeLtp = useRef(row.ce?.ltp);
  const prevPeLtp = useRef(row.pe?.ltp);
  const [ceFlash, setCeFlash] = useState('');
  const [peFlash, setPeFlash] = useState('');

  useEffect(() => {
    const ce = row.ce?.ltp;
    const prev = prevCeLtp.current;
    if (ce != null && prev != null && ce !== prev) {
      setCeFlash(ce > prev ? 'ltp-flash-up' : 'ltp-flash-down');
      const t = setTimeout(() => setCeFlash(''), 300);
      prevCeLtp.current = ce;
      return () => clearTimeout(t);
    }
    prevCeLtp.current = ce;
  }, [row.ce?.ltp]);

  useEffect(() => {
    const pe = row.pe?.ltp;
    const prev = prevPeLtp.current;
    if (pe != null && prev != null && pe !== prev) {
      setPeFlash(pe > prev ? 'ltp-flash-up' : 'ltp-flash-down');
      const t = setTimeout(() => setPeFlash(''), 300);
      prevPeLtp.current = pe;
      return () => clearTimeout(t);
    }
    prevPeLtp.current = pe;
  }, [row.pe?.ltp]);

  const openChart = (side: QuoteSide | null, strike: number, type: 'CE' | 'PE') => {
    if (!side?.instrument_token || !side.tradingsymbol) return;
    if (!tradingDate) {
      alert('Please select a trading date first');
      return;
    }
    onSelectContract(side.instrument_token, side.tradingsymbol, strike, type);
  };

  const addLegFromChain = (
    quoteSide: QuoteSide | null,
    strike: number,
    type: 'CE' | 'PE',
    transactionSide: 'BUY' | 'SELL'
  ) => {
    if (!onAddLeg || !quoteSide?.tradingsymbol || quoteSide.ltp == null) return;
    const ltp = Number(quoteSide.ltp);
    if (!Number.isFinite(ltp)) return;
    onAddLeg({
      side: transactionSide,
      strike,
      optionType: type,
      tradingsymbol: quoteSide.tradingsymbol,
      ltp,
      lots: defaultLots,
    });
  };

  const renderRowActions = (
    quoteSide: QuoteSide | null,
    strike: number,
    type: 'CE' | 'PE'
  ) => {
    if (!hasContract(quoteSide)) return null;
    const label = quoteSide?.tradingsymbol
      ? `Chart ${quoteSide.tradingsymbol}`
      : `Chart ${strike} ${type}`;
    const btnClass =
      type === 'CE'
        ? 'btn btn-sm row-chart-btn btn-outline-success'
        : 'btn btn-sm row-chart-btn btn-outline-danger';
    return (
      <div className="row-action-btns">
        {onAddLeg && quoteSide?.ltp != null && (
          <>
            <button
              type="button"
              className="btn btn-sm row-trade-btn btn-outline-success"
              title={`Buy ${quoteSide.tradingsymbol}`}
              aria-label={`Buy ${quoteSide.tradingsymbol}`}
              onClick={(e) => {
                e.stopPropagation();
                addLegFromChain(quoteSide, strike, type, 'BUY');
              }}
            >
              <i className="bi bi-cart-plus" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-sm row-trade-btn btn-outline-danger"
              title={`Sell ${quoteSide.tradingsymbol}`}
              aria-label={`Sell ${quoteSide.tradingsymbol}`}
              onClick={(e) => {
                e.stopPropagation();
                addLegFromChain(quoteSide, strike, type, 'SELL');
              }}
            >
              <i className="bi bi-cart-dash" aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className={btnClass}
          title={label}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            openChart(quoteSide, strike, type);
          }}
        >
          <i className="bi bi-graph-up" aria-hidden="true" />
          <span className="row-chart-btn-label">{type}</span>
        </button>
      </div>
    );
  };

  const isAtm = atmStrike != null && row.strike === atmStrike;
  const itmCe = row.strike < spot;
  const itmPe = row.strike > spot;
  const hl = highlightStrike != null && row.strike === highlightStrike;
  const ceLtpSpike = isLtpSpike(row.ce?.ltp_chg_pct, priceSpikeThreshold);
  const peLtpSpike = isLtpSpike(row.pe?.ltp_chg_pct, priceSpikeThreshold);
  const peIvSpike = isIvSpike(row.pe?.iv_chg_pct, row.pe?.iv_chg, ivSpikeThreshold);
  const spikeClass = (active: boolean) => (active ? 'spike-highlight' : '');

  return (
    <tr
      className={`option-chain-row ${isAtm ? 'row-atm' : ''} ${hl ? 'table-info' : ''} ${isHovered ? 'row-hovered' : ''}`}
      onMouseEnter={onMouseEnter}
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
      <td className={`call-side ${chgClass(row.ce?.ltp_chg)} ${spikeClass(ceLtpSpike)}`}>
        {fmtChgAbs(row.ce?.ltp_chg)}
      </td>
      <td
        className={`call-side border-end ltp-col ${ltpColClass(row.ce?.ltp_chg_pct)} ${ceFlash} ${spikeClass(ceLtpSpike)}`}
      >
        <div className="ltp-cell-inner">
          <span className="ltp-value">
            {row.ce?.ltp != null ? (
              <>
                <span className="ltp-price">{fmt(row.ce.ltp)}</span>
                <span className="ltp-chg-pct">{fmtChgPct(row.ce.ltp_chg_pct)}</span>
              </>
            ) : (
              '—'
            )}
          </span>
          {isHovered && renderRowActions(row.ce, row.strike, 'CE')}
        </div>
      </td>
      <td className="text-center border-end strike-col">{row.strike}</td>
      <td className={`put-side ${spikeClass(peIvSpike)}`}>
        {row.pe?.iv != null ? (
          <>
            <span className="iv-level">{fmt(row.pe.iv, 1)}</span>{' '}
            <span className={chgClass(row.pe?.iv_chg)}>
              ({fmtChgAbs(row.pe?.iv_chg, 1)})
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td
        className={`put-side ltp-col ${ltpColClass(row.pe?.ltp_chg_pct)} ${peFlash} ${spikeClass(peLtpSpike)}`}
      >
        <div className="ltp-cell-inner">
          <span className="ltp-value">
            {row.pe?.ltp != null ? (
              <>
                <span className="ltp-price">{fmt(row.pe.ltp)}</span>
                <span className="ltp-chg-pct">{fmtChgPct(row.pe.ltp_chg_pct)}</span>
              </>
            ) : (
              '—'
            )}
          </span>
          {isHovered && renderRowActions(row.pe, row.strike, 'PE')}
        </div>
      </td>
      <td className={`put-side ${chgClass(row.pe?.ltp_chg)} ${spikeClass(peLtpSpike)}`}>
        {fmtChgAbs(row.pe?.ltp_chg)}
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
});

const OptionChainTable = forwardRef<OptionChainTableHandle, OptionChainTableProps>(function OptionChainTable(
  {
    chain,
    spot,
    atmStrike,
    tradingDate,
    scrollContextKey,
    onSelectContract,
    highlightStrike,
    defaultLots = 1,
    onAddLeg,
    priceSpikeThreshold,
    ivSpikeThreshold,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const lastScrollContextRef = useRef<string | null>(null);
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
    programmaticScrollRef.current = true;
    const scrollTop = row.offsetTop - h / 2 + row.clientHeight / 2;
    containerRef.current.scrollTo({
      top: scrollTop,
      behavior: 'smooth',
    });
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 400);
  }, [chain, atmStrike, scrollContextKey]);

  useImperativeHandle(ref, () => ({ scrollToAtm }), [scrollToAtm]);

  useEffect(() => {
    if (lastScrollContextRef.current !== scrollContextKey) {
      lastScrollContextRef.current = scrollContextKey;
      userScrolledRef.current = false;
    }
    if (userScrolledRef.current) return;
    const t = setTimeout(() => {
      if (!userScrolledRef.current) scrollToAtm();
    }, 150);
    return () => clearTimeout(t);
  }, [scrollContextKey, scrollToAtm]);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    if (!userScrolledRef.current) {
      userScrolledRef.current = true;
    }
  }, [scrollContextKey]);

  return (
    <div
      ref={containerRef}
      className="table-responsive"
      style={{ maxHeight: 'min(78vh, 900px)', overflowY: 'auto' }}
      onScroll={handleScroll}
    >
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
          {chain.map((row) => (
            <OptionChainRow
              key={row.strike}
              row={row}
              spot={spot}
              atmStrike={atmStrike}
              tradingDate={tradingDate}
              highlightStrike={highlightStrike}
              isHovered={hoveredStrike === row.strike}
              maxOi={maxOi}
              defaultLots={defaultLots}
              priceSpikeThreshold={priceSpikeThreshold}
              ivSpikeThreshold={ivSpikeThreshold}
              onMouseEnter={() => setHoveredStrike(row.strike)}
              onSelectContract={onSelectContract}
              onAddLeg={onAddLeg}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default OptionChainTable;
