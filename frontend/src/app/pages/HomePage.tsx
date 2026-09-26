import { ArrowUpRight, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeading from '../PageHeading'
import FlowerMark from '../../ui/FlowerMark'
import { scenarios } from '../scenarios/catalog'

export default function HomePage() {
  return <>
    <section className="gf-home-hero room:grid room:items-center" aria-label="欢迎来到金花牌室">
      <div className="gf-hero-copy">
        <p className="gf-eyebrow">金花牌室 / 界面预览</p>
        <PageHeading title="牌室">三张牌，<br />一场心局。</PageHeading>
        <p className="gf-intro">牌面藏在手中，心思落在桌上。<br />在这里，先感受一间新牌室的模样。</p>
        <Link to="/scenarios/waiting" className="gf-button room:inline-flex room:items-center room:justify-center room:gap-3 gf-button--primary">浏览场景 <ArrowRight size={18} aria-hidden="true" /></Link>
        <p className="gf-caption">固定示例，无需连接模型。</p>
      </div>
      <div className="gf-room-study" aria-hidden="true">
        <div className="gf-felt-inlay">
          <span className="gf-room-lettering">GOLDEN FLOWER</span>
          <div className="gf-card-fan">
            <div className="gf-art-card"><FlowerMark /></div>
            <div className="gf-art-card"><FlowerMark /></div>
            <div className="gf-art-card"><FlowerMark /></div>
          </div>
          <div className="gf-dealer-seal"><FlowerMark /><span>庄</span></div>
          <span className="gf-room-caption">三张牌 · 万般心思</span>
        </div>
      </div>
    </section>
    <section className="gf-scenario-directory" aria-labelledby="gf-directory-title">
      <div className="gf-section-heading"><div><p className="gf-eyebrow">牌室一览</p><h2 id="gf-directory-title">从一刻，看见一局</h2></div><span className="gf-muted">六个固定场景，自由浏览</span></div>
      <div className="gf-directory-grid room:grid">
        {scenarios.map((scenario) => <Link key={scenario.id} to={`/scenarios/${scenario.id}`} className="gf-directory-link">
          <span><strong>{scenario.title}</strong><small>{scenario.subtitle}</small></span><ArrowUpRight size={20} aria-hidden="true" />
        </Link>)}
      </div>
    </section>
  </>
}
