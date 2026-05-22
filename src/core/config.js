/**
 * @file config.js
 * @description 환경별 설정 (dev / prod)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 사용법:
 *   import { config } from './config.js'
 *   const url = config.LAYER_ENDPOINTS.L1
 */

const ENV = (typeof window !== 'undefined' && window.__GOPANG_ENV__)
  || (typeof process !== 'undefined' && process.env.GOPANG_ENV)
  || 'dev'

const DEV = {
  ENV: 'dev',

  // L1~L5 노드 엔드포인트 (개발: localhost 에뮬레이션)
  LAYER_ENDPOINTS: {
    L1: 'http://localhost:8001',
    L2: 'http://localhost:8002',
    L3: 'http://localhost:8003',
    L4: 'http://localhost:8004',
    L5: 'http://localhost:8005',
  },

  // DeepSeek API
  DEEPSEEK_API_URL: 'https://api.deepseek.com/v1/chat/completions',
  DEEPSEEK_MODEL:   'deepseek-chat',

  // OpenHash 메인넷
  OPENHASH_MAINNET: 'http://localhost:9000',

  // Verification API
  VERIFY_API_BASE: 'http://localhost:7000',

  // IndexedDB
  IDB_NAME:    'gopang_pdv_dev',
  IDB_VERSION: 1,

  // Merkle 배치 주기 (dev: 10초, prod: 1시간)
  MERKLE_BATCH_INTERVAL_MS: 10_000,

  // 로그 레벨
  LOG_LEVEL: 'debug',
}

const PROD = {
  ENV: 'prod',

  LAYER_ENDPOINTS: {
    L1: 'https://openhash-gopang.github.io/openhash-L1-ido1',
    L2: 'https://openhash-gopang.github.io/openhash-L2-jeju-city',
    L3: 'https://openhash-gopang.github.io/openhash-L3-jeju',
    L4: 'https://openhash-gopang.github.io/openhash-L4-kr',
    L5: 'https://openhash-gopang.github.io/openhash-L5-global',
  },

  DEEPSEEK_API_URL: 'https://api.deepseek.com/v1/chat/completions',
  DEEPSEEK_MODEL:   'deepseek-chat',

  OPENHASH_MAINNET: 'https://mainnet.openhash.kr',

  VERIFY_API_BASE: 'https://verify.gopang.net',

  IDB_NAME:    'gopang_pdv',
  IDB_VERSION: 1,

  MERKLE_BATCH_INTERVAL_MS: 3_600_000,   // 1시간

  LOG_LEVEL: 'warn',
}

export const config = Object.freeze(ENV === 'prod' ? PROD : DEV)
