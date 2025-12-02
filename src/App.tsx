// App.tsx
import React from 'react';
import RFTFluency3D from './components/RFTFluency3D';

const App: React.FC = () => {
  console.log('[App] rendering App component'); // <--- add this line

  return (
    <div className="w-screen h-screen bg-slate-900 overflow-hidden flex items-center justify-center">
      <RFTFluency3D />
    </div>
  );
};

export default App;
