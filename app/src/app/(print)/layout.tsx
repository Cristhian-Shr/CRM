/**
 * Layout para páginas de impressão (PDF): sem sidebar/header e sempre em tema
 * claro, para o resultado impresso ficar legível independente do tema do app.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.remove('dark')" }} />
      {children}
    </>
  );
}
