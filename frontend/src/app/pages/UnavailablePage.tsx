import { Link } from 'react-router-dom'
import PageHeading from '../PageHeading'
import FlowerMark from '../../ui/FlowerMark'

export default function UnavailablePage({ kind = 'missing' }: { kind?: 'live' | 'missing' }) {
  const title = kind === 'live' ? '这里还未开放实战' : '没有找到这一页'
  return <section className="gf-empty">
    <FlowerMark />
    <p className="gf-eyebrow">{kind === 'live' ? '牌室仍在布置' : '这张牌不在此处'}</p>
    <PageHeading title={title}>{title}</PageHeading>
    <p className="gf-muted">{kind === 'live' ? '当前版本仅供浏览界面场景，尚不能载入牌局或结果。' : '地址可能有误。返回牌室，选择一个可用场景。'}</p>
    <Link className="gf-button room:inline-flex room:items-center room:justify-center room:gap-3 gf-button--primary" to="/">返回牌室</Link>
  </section>
}
