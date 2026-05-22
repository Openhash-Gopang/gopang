/**
 * @file plugin-validator.js
 * @description 플러그인 등록 전 유효성 검사
 * @version 1.0.0
 * @author AI City Inc.
 */

import { REQUIRED_FIELDS } from './plugin-interface.js'

/**
 * semver 형식 검사 (x.y.z)
 * @param {string} version
 * @returns {boolean}
 */
function isSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(version)
}

/**
 * 중첩 객체에서 점 표기법으로 값 조회
 * 예: getNestedValue(obj, 'metadata.name')
 * @param {Object} obj
 * @param {string} path
 * @returns {any}
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined
    return acc[key]
  }, obj)
}

export class PluginValidator {

  /**
   * 플러그인 유효성 검사
   * @param {Object} plugin - GopangDomainPlugin 인스턴스
   * @throws {Error} 유효하지 않은 경우
   * @returns {true}
   */
  static async validate(plugin) {
    const name = plugin?.metadata?.name || '(이름 없음)'

    // 1. 필수 필드 존재 확인
    for (const field of REQUIRED_FIELDS) {
      const value = getNestedValue(plugin, field)
      if (value === undefined || value === null || value === '') {
        throw new Error(
          `[Validator] 플러그인 "${name}": 필수 필드 누락 — ${field}`
        )
      }
    }

    // 2. semver 형식 확인
    if (!isSemver(plugin.metadata.version)) {
      throw new Error(
        `[Validator] 플러그인 "${name}": 잘못된 버전 형식 — "${plugin.metadata.version}" (x.y.z 형식 필요)`
      )
    }

    // 3. 플러그인 이름 형식 확인 (소문자, 하이픈 허용)
    if (!/^[a-z][a-z0-9-]*$/.test(plugin.metadata.name)) {
      throw new Error(
        `[Validator] 플러그인 "${name}": 이름은 소문자·숫자·하이픈만 허용됩니다`
      )
    }

    // 4. 생명주기 훅이 함수인지 확인
    for (const hook of ['onLoad', 'onUnload', 'onUpdate']) {
      if (typeof plugin[hook] !== 'function') {
        throw new Error(
          `[Validator] 플러그인 "${name}": ${hook}은 함수여야 합니다`
        )
      }
    }

    // 5. legalClassifier.classify가 함수인지 확인
    if (typeof plugin.legalClassifier.classify !== 'function') {
      throw new Error(
        `[Validator] 플러그인 "${name}": legalClassifier.classify는 함수여야 합니다`
      )
    }

    // 6. riskRules가 배열인지 확인
    if (!Array.isArray(plugin.riskRules)) {
      throw new Error(
        `[Validator] 플러그인 "${name}": riskRules는 배열이어야 합니다`
      )
    }

    // 7. classify() 최소 동작 확인 (테스트 메시지)
    try {
      await plugin.legalClassifier.classify([])
    } catch (err) {
      throw new Error(
        `[Validator] 플러그인 "${name}": legalClassifier.classify() 실행 오류 — ${err.message}`
      )
    }

    return true
  }
}
