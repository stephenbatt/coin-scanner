import { Routes, Route, NavLink } from 'react-router-dom';
import { Camera, Library, Home as HomeIcon } from 'lucide-react';
import Home from './pages/Home.jsx';
import Scan from './pages/Scan.jsx';
import Catalog from './pages/Catalog.jsx';

export default function App(){
  return <div className="app-shell">
    <main><Routes><Route path="/" element={<Home/>}/><Route path="/scan" element={<Scan/>}/><Route path="/catalog" element={<Catalog/>}/></Routes></main>
    <nav className="bottom-nav">
      <NavLink to="/" end><HomeIcon size={21}/><span>Home</span></NavLink>
      <NavLink to="/scan" className="scan-nav"><Camera size={26}/><span>Scan</span></NavLink>
      <NavLink to="/catalog"><Library size={21}/><span>Catalog</span></NavLink>
    </nav>
  </div>
}
