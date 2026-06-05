// Allow importing raw SQL files as bundled string constants (Vite ?raw).
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
