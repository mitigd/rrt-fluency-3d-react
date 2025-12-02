import React from 'react';
import RFTFluency3D from './components/RFTFluency3D';

const App: React.FC = () => {
  return (
    // Enforcing full viewport height and width with slate-900 background for the dark theme requirement
    <div className="w-screen h-screen bg-slate-900 overflow-hidden flex items-center justify-center">
      <RFTFluency3D />
    </div>
  );
};

export default App;