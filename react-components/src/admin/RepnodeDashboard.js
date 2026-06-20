import React, { useState } from 'react';
import RepnodeKeys from './RepnodeKeys';
import DashboardOverview from './DashboardOverview';
import Wallets from './Wallets';
import Rewards from './Rewards';
import Transactions from './Transactions';
import NodeStats from './NodeStats';
import Settings from './Settings';

export default function RepnodeDashboard({ walletAddress }) {
  const sidebarItems = [
    { label: 'Overview', component: <DashboardOverview /> },
    { label: 'Repnode Keys', component: <RepnodeKeys allowAddKey={false} /> },
    { label: 'Wallets', component: <Wallets mode="repnode" walletAddress={walletAddress} /> },
    { label: 'Rewards', component: <Rewards mode="repnode" walletAddress={walletAddress} /> },
    { label: 'Transactions', component: <Transactions mode="repnode" walletAddress={walletAddress} /> },
    { label: 'Node Stats', component: <NodeStats mode="repnode" walletAddress={walletAddress} /> },
    { label: 'Settings', component: <Settings /> },
  ];
  const [active, setActive] = useState(0);

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-logo">
          <img src="/iccwallet-fox.svg" alt="ICC REP Node" />
        </div>
        <div className="admin-sidebar-title">REP Node</div>
        <nav>
          {sidebarItems.map((item, i) => (
            <div
              key={item.label}
              onClick={() => setActive(i)}
              className={`admin-nav-item ${active === i ? 'active' : ''}`}
            >
              {item.label}
            </div>
          ))}
        </nav>
      </aside>
      <main className="admin-main">
        {sidebarItems[active].component}
      </main>
    </div>
  );
}
