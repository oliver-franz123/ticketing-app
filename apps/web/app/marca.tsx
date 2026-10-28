import Link from 'next/link';

// Wordmark de texto: "Ya" en 800 y "Kache" en 600, en el acento vivo.
export function Marca() {
  return (
    <Link href="/" className="marca" aria-label="YaKache, inicio">
      <strong>Ya</strong>Kache
    </Link>
  );
}
