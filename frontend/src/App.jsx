import ReviewQueue from './components/ReviewQueue';
import { ShieldCheck, Activity } from 'lucide-react';

function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 selection:bg-blue-500/30 font-sans relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-[500px] bg-blue-500/10 blur-[120px] rounded-full pointer-events-none -z-10" />
      <div className="absolute -top-[200px] -right-[200px] w-[600px] h-[600px] bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none -z-10" />
      
      {/* Header */}
      <header className="border-b border-white/5 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.3)]">
              <ShieldCheck className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                RecoverAI
              </h1>
              <p className="text-xs text-slate-400 font-medium tracking-wide uppercase">Operator Dashboard</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">System Active</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-blue-500" />
            Manual Review Queue
          </h2>
          <p className="text-slate-400 text-lg">
            Review edge-cases that the policy engine flagged for human intervention.
          </p>
        </div>

        <ReviewQueue />
        
      </main>
    </div>
  );
}

export default App;
