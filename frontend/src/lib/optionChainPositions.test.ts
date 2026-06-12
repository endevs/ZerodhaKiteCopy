import { positionsByTradingsymbol } from './optionChainPositions';
import { PositionInput } from './payoffDiagram';

describe('optionChainPositions', () => {
  it('maps NIFTY weekly CE/PE positions by tradingsymbol', () => {
    const positions: PositionInput[] = [
      {
        tradingsymbol: 'NIFTY2610619100CE',
        quantity: 75,
        buy_price: 120,
        sell_price: 0,
      },
      {
        tradingsymbol: 'NIFTY2610624200PE',
        quantity: -50,
        buy_price: 0,
        sell_price: 80,
      },
    ];

    const map = positionsByTradingsymbol(positions, 'NIFTY');

    expect(map.size).toBe(2);
    const ce = map.get('NIFTY2610619100CE');
    expect(ce).toMatchObject({
      optionType: 'CE',
      side: 'B',
      absLots: 75,
      quantity: 75,
    });

    const pe = map.get('NIFTY2610624200PE');
    expect(pe).toMatchObject({
      optionType: 'PE',
      side: 'S',
      absLots: 50,
      quantity: -50,
    });
  });

  it('filters out other indices', () => {
    const positions: PositionInput[] = [
      {
        tradingsymbol: 'BANKNIFTY26JUN52000CE',
        quantity: 30,
        buy_price: 200,
      },
    ];

    const map = positionsByTradingsymbol(positions, 'NIFTY');
    expect(map.size).toBe(0);
  });

  it('ignores zero quantity and invalid symbols', () => {
    const positions: PositionInput[] = [
      { tradingsymbol: 'NIFTY2610619100CE', quantity: 0, buy_price: 1 },
      { tradingsymbol: 'RELIANCE', quantity: 10, buy_price: 1 },
    ];

    expect(positionsByTradingsymbol(positions, 'NIFTY').size).toBe(0);
  });
});
