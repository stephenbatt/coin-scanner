import { Link } from 'react-router-dom';
import { Camera, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { loadCoins, money } from '../lib.js';
export default function Home(){
 const coins=loadCoins(); const low=coins.reduce((s,c)=>s+(Number(c.value_low)||0),0); const high=coins.reduce((s,c)=>s+(Number(c.value_high)||0),0);
 return <div className="page home-page"><header className="brand"><div className="brand-eye">RE</div><div><h1>RedEye Coin Scanner</h1><p>Identify it. Price it. Save it.</p></div></header>
 <section className="hero"><Sparkles className="hero-spark"/><h2>What is your coin worth?</h2><p>Photograph both sides. The scanner enhances the images, reads the markings, identifies likely matches, and estimates a market range.</p><Link className="primary big" to="/scan"><Camera/> Scan a coin</Link></section>
 <section className="stats"><div><span>Collection</span><strong>{coins.length} items</strong></div><div><span>Estimated range</span><strong>{money(low)}–{money(high)}</strong></div></section>
 <section className="feature-list"><div><ShieldCheck/><p><b>Your key stays private.</b><br/>Google Vision is called only by the server.</p></div><div><TrendingUp/><p><b>Market-aware estimates.</b><br/>Results include pricing confidence and direct comparison links.</p></div></section></div>
}
