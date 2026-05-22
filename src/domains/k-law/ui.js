/**
 * @file ui.js  (k-law)
 * @description K-Law UI 컴포넌트
 */
export const uiComponents = {
  /** 채팅 위험 배지 */
  chatBadge: (level, flags) => {
    const colors = { S0:'#22c55e', S1:'#f59e0b', S2:'#f97316', S3:'#ef4444' }
    const color  = colors[level] ?? '#6b7280'
    return `<span class="klaw-badge" style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">
      ⚖️ ${level} ${flags.length > 0 ? '· ' + flags.slice(0,2).join(' ') : ''}
    </span>`
  },

  /** 대시보드 위젯 */
  dashboardWidget: () => `<div class="klaw-widget">
    <h3>⚖️ K-Law (사법)</h3>
    <p>위법성 자동 감지 · 예방법학 엔진</p>
  </div>`,

  /** 상세 보고 패널 */
  reportPanel: (riskResult) => `<div class="klaw-report">
    <h4>⚖️ K-Law 판정 결과</h4>
    <p>등급: <strong>${riskResult.level}</strong> (점수: ${riskResult.score})</p>
    <p>법령 플래그: ${riskResult.legalFlags.join(', ') || '없음'}</p>
    <p>${riskResult.message}</p>
  </div>`,
}
