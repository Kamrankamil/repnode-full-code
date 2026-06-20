import React from 'react';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

const lineData = {
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  datasets: [
    {
      label: 'Rewards',
      data: [120, 220, 180, 260, 300, 280, 360],
      borderColor: '#1a3a52',
      backgroundColor: 'rgba(26,58,82,0.15)',
      tension: 0.4,
      fill: true
    }
  ]
};

const barData = {
  labels: ['Node 1', 'Node 2', 'Node 3', 'Node 4', 'Node 5'],
  datasets: [
    {
      label: 'Transactions',
      data: [45, 62, 38, 80, 54],
      backgroundColor: '#d4a574'
    }
  ]
};

const doughnutData = {
  labels: ['Completed', 'Pending', 'Failed'],
  datasets: [
    {
      data: [80, 12, 8],
      backgroundColor: ['#1a3a52', '#d4a574', '#c53030']
    }
  ]
};

export default function DashboardOverview() {
  return (
    <div className="admin-card">
      <h2 className="admin-title">Dashboard Overview</h2>

      <div className="admin-stats-grid" style={{ marginBottom: 24 }}>
        <div className="admin-stat-card">
          <div className="admin-stat-title">Total Nodes</div>
          <div className="admin-stat-value">5</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-title">Total Rewards</div>
          <div className="admin-stat-value">151123394.8</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-title">Total Transactions</div>
          <div className="admin-stat-value">166</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-title">Status</div>
          <div className="admin-stat-value">Active</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'stretch' }}>
        <div className="admin-card" style={{ margin: 0 }}>
          <h3 className="admin-title">Weekly Rewards</h3>
          <Line data={lineData} options={{ plugins: { legend: { display: false } } }} />
        </div>
        <div className="admin-card" style={{ margin: 0 }}>
          <h3 className="admin-title">Transaction Status</h3>
          <Doughnut data={doughnutData} options={{ plugins: { legend: { position: 'bottom' } } }} />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="admin-card" style={{ margin: 0 }}>
          <h3 className="admin-title">Transactions by Node</h3>
          <Bar data={barData} options={{ plugins: { legend: { display: false } } }} />
        </div>
      </div>
    </div>
  );
}
