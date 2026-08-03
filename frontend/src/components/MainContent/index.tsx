'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <main
      className={`meetily-main-content min-w-0 flex-none overflow-hidden transition-[margin-left,width] duration-300 ${
        isCollapsed ? 'ml-16 w-[calc(100%-4rem)]' : 'ml-64 w-[calc(100%-16rem)]'
      }`}
    >
      <div className="min-w-0 w-full pl-8">
        {children}
      </div>
    </main>
  );
};

export default MainContent;
