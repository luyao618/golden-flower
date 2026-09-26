import { useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import type { CardDTO, GameStateDTO, PlayerStatus } from '../../domain/game'
import { createCompareReplay, createHandReplay, createStartReplay } from '../../test/fixtures/gameReplays'
import Button from '../../ui/Button'
import Dialog from '../../ui/Dialog'
import Field from '../../ui/Field'
import FlowerMark from '../../ui/FlowerMark'
import Status from '../../ui/Status'
import Tabs from '../../ui/Tabs'
import PageHeading from '../PageHeading'
import { scenarios } from '../scenarios/catalog'
import UnavailablePage from './UnavailablePage'

type Scenario = typeof scenarios[number]
const number = new Intl.NumberFormat('zh-CN')
const statuses: Record<PlayerStatus, string> = {
  active_blind: '未看牌', active_seen: '已看牌', folded: '已弃牌', compare_lost: '比牌落败', out: '已离席',
}
const suits: Record<CardDTO['suit'], { name: string, symbol: string }> = {
  spades: { name: '黑桃', symbol: '♠' }, hearts: { name: '红桃', symbol: '♥' },
  clubs: { name: '梅花', symbol: '♣' }, diamonds: { name: '方块', symbol: '♦' },
}

// Pure fixture selection. There is no session store, replay timer, transport or
// action dispatcher in this route. A route mount gets an independent snapshot.
function snapshotFor(id: Scenario['id']): GameStateDTO {
  switch (id) {
    case 'waiting': return createStartReplay().waiting
    case 'blind': return createHandReplay().humanTurn
    case 'seen': return createHandReplay().seen
    case 'settlement': return createHandReplay().settled
    case 'six-seats': return createStartReplay(5).humanTurn
    case 'compare-private': return createCompareReplay('human').after
  }
}

function Snapshot({ snapshot }: { snapshot: GameStateDTO }) {
  const round = snapshot.current_round
  const viewer = snapshot.players.find((player) => player.player_type === 'human')
  // Even synthetic DTOs contain the blind viewer's private cards. Never render
  // those faces (including hidden nodes/attributes) until the fixture is seen.
  const visibleCards = viewer?.status === 'active_seen' ? viewer.hand : null
  return <div className="gf-snapshot">
    <div className="gf-snapshot-caption"><span>席位名册</span><span>{snapshot.players.length} 人 · {round ? `第 ${round.round_number} 局` : '尚未发牌'}</span></div>
    <ul className="gf-roster" aria-label="席位名册">
      {snapshot.players.map((player, index) => <li key={player.id}>
        <span className={`gf-seat-monogram ${player.player_type === 'human' ? 'gf-seat-monogram--human' : ''}`} aria-hidden="true">{player.player_type === 'human' ? '你' : String(index).padStart(2, '0')}</span>
        <div className="gf-seat-identity"><strong>{player.name}</strong><span>{round ? statuses[player.status] : '等待开局'}</span></div>
        {round?.dealer_index === index && <span className="gf-dealer-badge" aria-label="庄家"><FlowerMark /></span>}
        <span className="gf-chip-count"><strong>{number.format(player.chips)}</strong><small>筹码</small></span>
      </li>)}
    </ul>
    <div className="gf-hand-study">
      <div><p className="gf-eyebrow">你的手牌</p><h2>{!round ? '好戏，尚未开始。' : visibleCards ? '牌面已明，心思未定。' : '留一份未知。'}</h2>
        <p className="gf-muted">{!round ? '此场景停在发牌之前。' : visibleCards ? '只展示此场景中已看过的手牌。' : '三张牌保持朝下，不展示点数与花色。'}</p>
      </div>
      {!round ? <div className="gf-unplayed"><FlowerMark /><span>尚未发牌</span></div> : visibleCards ? <div className="gf-visible-hand">
        {visibleCards.map((card) => {
          const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ?? card.rank
          return <span key={`${card.suit}-${card.rank}`} role="img" aria-label={`${suits[card.suit].name} ${rank}`}
            className={`gf-face ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'gf-face--red' : ''}`}>
            <span aria-hidden="true">{rank}<small>{suits[card.suit].symbol}</small></span><b aria-hidden="true">{suits[card.suit].symbol}</b>
          </span>
        })}
      </div> : <div className="gf-hidden-hand" role="img" aria-label="三张未看牌">
        {[0, 1, 2].map((index) => <span key={index} className="gf-card-back" aria-hidden="true"><FlowerMark /></span>)}
      </div>}
    </div>
  </div>
}

function ScenarioView({ scenario }: { scenario: Scenario }) {
  const [snapshot] = useState(() => snapshotFor(scenario.id))
  const round = snapshot.current_round
  // Settlement snapshots already include the payout in player stacks. Keep
  // that historical pot labelled separately from an outstanding betting pot.
  const potLabel = round?.phase === 'settlement' || round?.phase === 'game_over'
    ? '本局底池（已派发）' : '当前底池'
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  return <>
    <div className="gf-page-topline"><Link to="/">← 返回牌室</Link><span className="gf-preview-tag">固定场景 · 实战未连接</span></div>
    <div className="gf-scenario-heading"><div><p className="gf-eyebrow">{scenario.subtitle}</p><PageHeading title={scenario.title}>{scenario.title}</PageHeading></div>
      <p className="gf-muted">{scenario.description}</p>
    </div>
    <nav className="gf-scenario-nav" aria-label="选择场景">
      {scenarios.map((item) => <NavLink key={item.id} to={`/scenarios/${item.id}`}>{item.title}</NavLink>)}
    </nav>
    <div className="gf-scenario-layout room:grid room:items-start">
      <section className="gf-scenario-surface" aria-label="场景预览">
        <Tabs label="场景信息" items={[
          { id: 'snapshot', label: '席位与手牌', content: <Snapshot snapshot={snapshot} /> },
          { id: 'about', label: '场景说明', content: <div className="gf-prose gf-scenario-about">
            <h2>停在这一刻</h2><p>{scenario.description}</p><p>这是一个固定快照，不会自动推进牌局。切换场景只会打开另一份示例。</p>
            <p>名册中的筹码直接来自示例；对手的隐藏牌不会显示。这里没有下注、模型连接或牌局保存功能。</p>
          </div> },
        ]} />
      </section>
      <aside className="gf-reading-card" aria-labelledby="gf-reading-title">
        <FlowerMark /><p className="gf-eyebrow">阅览席</p><h2 id="gf-reading-title">慢一点，读一局。</h2>
        <p>切换场景，看看发牌前、看牌后与本局落定时的不同模样。</p>
        <dl className="gf-snapshot-facts"><div><dt>场景人数</dt><dd>{snapshot.players.length} 人</dd></div>
          <div><dt>起始筹码 / 人</dt><dd>{number.format(snapshot.config.initial_chips)}</dd></div>
          <div><dt>底注</dt><dd>{number.format(snapshot.config.ante)}</dd></div>
          <div><dt>{potLabel}</dt><dd>{number.format(round?.pot ?? 0)}</dd></div>
        </dl>
        <p id="gf-note-help">便签仅保留在当前页面，刷新或切换场景后清空。</p>
        <Button variant="secondary" aria-describedby="gf-note-help"
          onClick={() => { setDraft(note); setError(''); setNoteOpen(true) }}>{note ? '编辑便签' : '添加便签'}</Button>
        <Status tone={note ? 'success' : 'info'}>{note ? '便签已更新，仅保留在当前场景。' : '筹码为只读示例，不会进行下注。'}</Status>
        {note && <p className="gf-note">{note}</p>}
      </aside>
    </div>
    <Dialog open={noteOpen} onClose={() => setNoteOpen(false)} title="场景便签" description="记下此刻的想法。刷新或切换场景后，便签会清空。">
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim()) { setError('请输入便签内容。'); return }
        setNote(draft.trim())
        setNoteOpen(false)
      }}>
        <Field label="便签内容" hint="最多 40 字，仅保留在当前页面。" error={error} maxLength={40}
          value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} />
        <div className="gf-dialog-actions room:flex room:justify-end room:gap-3"><Button variant="secondary" onClick={() => setNoteOpen(false)}>取消</Button><Button type="submit">保存便签</Button></div>
      </form>
    </Dialog>
  </>
}

export default function ScenarioPage() {
  const { scenarioId } = useParams()
  const scenario = scenarios.find((item) => item.id === scenarioId)
  return scenario ? <ScenarioView key={scenario.id} scenario={scenario} /> : <UnavailablePage />
}
