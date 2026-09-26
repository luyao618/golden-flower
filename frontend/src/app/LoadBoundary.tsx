import { Component, type ReactNode } from 'react'

export default class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <div role="alert" className="gf-load-error">
      <h1>页面未能打开</h1>
      <p>请重新载入页面，或返回牌室。</p>
      <button type="button" onClick={() => window.location.reload()}>重新载入</button>
      <a href="/">返回牌室</a>
    </div>
    return this.props.children
  }
}
