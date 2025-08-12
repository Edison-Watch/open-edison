declare module 'sql.js' {
  type SqlJsConfig = { locateFile?: (file: string) => string }
  export default function initSqlJs(config?: SqlJsConfig): Promise<any>
}


