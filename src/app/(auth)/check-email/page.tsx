import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tjek din e-mail — Advisory Board Unlimited",
};

export default function CheckEmailPage() {
  return (
    <main className="focus-page">
      <div className="focus-page__inner">
        <Image
          className="focus-page__mark"
          src="/brand/abu-mark-01-light-on-dark.svg"
          alt="Advisory Board Unlimited"
          width={96}
          height={96}
          priority
        />
        <div className="panel stack">
          <h1 className="heading-3 heading--on-light">Tjek din e-mail</h1>
          <p className="body">
            Vi har sendt dig et bekræftelseslink. Åbn det for at aktivere din konto — så kan du
            logge ind.
          </p>
          <p className="form__alt">
            Bekræftet allerede? <Link href="/login">Log ind</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
