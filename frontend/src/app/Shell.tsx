import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Button from '../ui/Button'
import Dialog from '../ui/Dialog'
import FlowerMark from '../ui/FlowerMark'
import LoadBoundary from './LoadBoundary'

export default function Shell() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const { pathname } = useLocation()
  return <>
    <a className="gf-skip" href="#gf-main">跳到主要内容</a>
    <header className="gf-header room:flex room:items-center room:justify-between room:gap-6">
      <Link to="/" className="gf-brand room:inline-flex room:items-center room:gap-3" aria-label="大模型炸金花 · 牌室首页">
        <FlowerMark />
        <span><strong>大模型炸金花</strong><small>GOLDEN FLOWER CARD ROOM</small></span>
      </Link>
      <nav aria-label="主要导航">
        <NavLink to="/" end>牌室</NavLink>
        <NavLink to="/scenarios">场景</NavLink>
        <Button variant="secondary" onClick={() => setAboutOpen(true)}>牌室说明</Button>
      </nav>
    </header>
    <main id="gf-main" tabIndex={-1} className="gf-main">
      <LoadBoundary key={pathname}><Outlet /></LoadBoundary>
    </main>
    <footer className="gf-footer"><span>三张牌 · 万般心思</span><span>界面预览 · 不连接实战</span></footer>
    <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="牌室说明"
      description="这里是一间尚在布置的牌室。你可以先浏览场景，体验新的界面。">
      <div className="gf-prose">
        <p>每个场景都使用固定示例。切换场景不会发牌、下注，也不会联系模型。</p>
        <p>三张牌的秘密留在牌背之后。只有看牌场景会展示你的手牌；对手的隐藏牌不会显示。</p>
        <p>实战、模型配置与牌局记录将在后续开放。</p>
      </div>
      <Button onClick={() => setAboutOpen(false)}>继续浏览</Button>
    </Dialog>
  </>
}
