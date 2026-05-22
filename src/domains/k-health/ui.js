/**
 * @file ui.js  (k-health)
 */
export const uiComponents = {
  chatBadge: (level, flags) => {
    const colors = { S0:'#22c55e', S1:'#f59e0b', S2:'#f97316', S3:'#ef4444' }
    return `<span class="khealth-badge" style="background:${colors[level]??'#6b7280'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">
      🏥 ${level} ${flags.length>0?'· '+flags.slice(0,2).join(' '):''}
    </span>`
  },
  dashboardWidget: () => `<div class="khealth-widget"><h3>🏥 K-Health (의료)</h3><p>의료법·약사법 위법성 자동 감지</p></div>`,
  reportPanel: (riskResult) => `<div class="khealth-report">
    <h4>🏥 K-Health 판정 결과</h4>
    <p>등급: <strong>${riskResult.level}</strong></p>
    <p>의료 플래그: ${riskResult.legalFlags.join(', ')||'없음'}</p>
  </div>`,
}
