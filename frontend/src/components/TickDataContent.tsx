import React, { useState, useEffect } from 'react';

interface TickDataStatus {
  instrument: string;
  status: string;
  row_count: number;
  last_collected_at: string;
  instrument_token: string; // Assuming this is needed for the chart
}

interface TickDataContentProps {
  onViewChart: (instrumentToken: string) => void;
}

const TickDataContent: React.FC<TickDataContentProps> = ({ onViewChart }) => {
  const [tickData, setTickData] = useState<TickDataStatus[]>([]);

  const fetchTickDataStatus = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/tick_data_status');
      const data = await response.json();
      if (response.ok) {
        setTickData(data);
      } else {
        console.error('Error fetching tick data status:', data.message);
      }
    } catch (error) {
      console.error('Error fetching tick data status:', error);
    }
  };

  useEffect(() => {
    fetchTickDataStatus();
    const interval = setInterval(fetchTickDataStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (action: 'start' | 'pause' | 'stop') => {
    try {
      const response = await fetch(`http://localhost:8000/api/tick_data/${action}`, { method: 'POST' });
      if (response.ok) {
        fetchTickDataStatus(); // Refresh status after action
      } else {
        console.error(`Error ${action}ing tick data:`, response.statusText);
      }
    } catch (error) {
      console.error(`Error ${action}ing tick data:`, error);
    }
  };

  return (
    <div className="container mt-4">
      <h2>Tick Data Collection Status</h2>
      <div className="mb-3">
        <button className="btn btn-success me-2" onClick={() => handleAction('start')}>Start</button>
        <button className="btn btn-warning me-2" onClick={() => handleAction('pause')}>Pause</button>
        <button className="btn btn-danger me-2" onClick={() => handleAction('stop')}>Stop</button>
        <button className="btn btn-primary" onClick={fetchTickDataStatus}>Refresh</button>
      </div>
      <table className="table table-striped">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Status</th>
            <th>Row Count</th>
            <th>Last Collected At</th>
            <th>Chart</th>
          </tr>
        </thead>
        <tbody id="tick-data-status-table-body">
          {tickData.length === 0 ? (
            <tr>
              <td colSpan={5}>No tick data being collected.</td>
            </tr>
          ) : (
            tickData.map((item) => (
              <tr key={item.instrument}>
                <td>{item.instrument}</td>
                <td>{item.status}</td>
                <td>{item.row_count}</td>
                <td>{item.last_collected_at}</td>
                <td>
                  <i
                    className="fas fa-chart-line"
                    onClick={() => onViewChart(item.instrument_token)}
                    style={{ cursor: 'pointer' }}
                  ></i>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default TickDataContent;
