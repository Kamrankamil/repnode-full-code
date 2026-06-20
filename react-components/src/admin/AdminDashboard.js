import React, { useState } from 'react';
import RepnodeKeys from './RepnodeKeys';
import DashboardOverview from './DashboardOverview';
import Wallets from './Wallets';
import Rewards from './Rewards';
import Transactions from './Transactions';
import NodeStats from './NodeStats';
import Settings from './Settings';
import StakingOperations from './StakingOperations';

const sidebarItems = [
  { label: 'Overview', component: <DashboardOverview /> },
  { label: 'Repnode Keys', component: <RepnodeKeys allowAddKey /> },
  { label: 'Wallets', component: <Wallets mode="admin" /> },
  { label: 'Rewards', component: <Rewards mode="admin" /> },
  { label: 'Transactions', component: <Transactions mode="admin" /> },
  { label: 'Node Stats', component: <NodeStats mode="admin" /> },
  { label: 'Staking Ops', component: <StakingOperations /> },
  { label: 'Settings', component: <Settings /> },
];

export default function AdminDashboard() {
  const [active, setActive] = useState(0);
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-logo">
          <img src="/iccwallet-fox.svg" alt="ICC REP Node" />
        </div>
        <div className="admin-sidebar-title">REP Node Admin</div>
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
