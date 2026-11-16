| [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [日本語](README.ja.md) | **Română ✓** |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

Gestionați cookie-urile, Local Storage și Session Storage pentru site-ul pe care îl alegeți, dintr-o fereastră pop-up sau din panoul lateral Chrome. Conceput pentru dezvoltatori, testeri și utilizatori avansați care doresc să inspecteze și să modifice datele site-ului fără a deschide DevTools.

## Începeți

1. Instalați [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda) din magazinul online Chrome.
2. Deschideți o pagină HTTP/HTTPS și faceți clic pe pictograma extensiei.
3. Aprobați accesul la site-ul selectat atunci când vi se solicită acest lucru, apoi alegeți „Cookie-uri”, „Local Storage” sau „Session Storage”.
4. Căutați, editați, importați sau exportați date. Deschideți panoul lateral pentru a beneficia de un spațiu de lucru mai mare sau activați reîncărcarea automată a paginii după efectuarea modificărilor.

Pentru instalarea locală, clonați acest depozit, deschideți `chrome://extensions`, activați modul „Developer” și utilizați opțiunea „Load unpacked” pentru a selecta folderul depozitului care conține `manifest.json`. Extensia rulează direct din fișierele incluse; nu este necesară nicio etapă de compilare.

## Caracteristici

- Căutați cookie-urile după nume, valoare, domeniu sau cale.
- Editorul păstrează domeniul, calea și atributele SameSite, Secure și HttpOnly ale fiecărui cookie atunci când îi modificați valoarea sau data de expirare.
- Creați și ștergeți cookie-uri, ștergeți elementele selectate și setați valori în bloc.
- Vizualizați, creați, editați și ștergeți înregistrările Local Storage și Session Storage.
- Cookie-urile HTTP preferate și intrările din spațiul de stocare web apar în partea de sus a fiecărei liste de date.
- Previzualizați exporturile și salvați vizualizarea curentă, elementele selectate sau toate datele site-ului sub forma unui pachet JSON cu versiuni, într-un fișier sau în clipboard. Importați cu previzualizare a diferențelor, selecție pe element, strategii de rezolvare a conflictelor, progres, rezultate și anulare în bloc.
- Importați și exportați cookie-urile în formatul „cookie-jar” Netscape/cURL, inclusiv cele care respectă convenția `#HttpOnly_` și cookie-urile de sesiune.
- Salvați local stările reutilizabile ale site-ului împreună cu etichetele, regulile de origine, strategiile implicite de rezolvare a conflictelor și variabilele introduse la aplicarea unei stări. Puteți redenumi, duplica, exporta, aplica sau șterge stările salvate.
- Importați rapid cookie-urile folosind câmpurile separate Name și Value sau adăugați o intrare de stocare cu `key=value`. Copiați valori, perechi `name=value` sau JSON structurate.
- Utilizați instrumentele de codificare/decodificare a adreselor URL, de formatare/compactare JSON și de decodificare a încărcăturii utile JWT în timpul editării valorilor.
- Verificați modificările recente și diferențele „înainte/după”, reîncercați operațiunile eșuate și anulați modificările acceptate în timpul sesiunii curente de navigare.
- Comutați între filele HTTP și HTTPS din fereastra curentă a browserului.

Formatul Netscape/cURL gestionează numai cookie-urile. Acesta nu păstrează atributul SameSite, informațiile despre partiții Partitioned/CHIPS sau identificatorul magazinului de cookie-uri Chrome. Utilizați pachetele JSON pentru a păstra aceste atribute și spațiul de stocare web.

## Limbi și teme

Interfața este disponibilă în engleză, chineză simplificată, chineză tradițională, spaniolă, portugheză braziliană, germană, franceză, japoneză și română. Toate traducerile sunt incluse în extensie și funcționează offline.

La prima utilizare, se selectează o limbă acceptată din lista de limbi a Chrome și se salvează; limbile care nu sunt incluse în listă vor folosi limba engleză ca limbă implicită. Setările locale pentru limba română, precum `ro-RO` și `ro-MD`, selectează limba română. Puteți schimba limba în orice moment folosind butonul de setări; schimbarea limbii păstrează schițele din editor.

Folosește butonul cu soarele/luna pentru a comuta între temele deschisă și închisă. În modul normal, tema implicită este cea deschisă, iar în modul incognito, cea închisă. Fiecare mod reține setarea aleasă independent de sistemul de operare, iar preferințele se sincronizează între ferestrele deschise ale extensiei aflate în același mod.

## Confidențialitate și controlul datelor

Fără reclame, analize, urmărirea utilizatorilor sau conturi. Datele site-ului sunt procesate pe dispozitivul tău și nu sunt încărcate, vândute sau partajate cu dezvoltatorul sau cu servere ale unor terțe părți. Se solicită accesul la site-ul pe care îl selectezi, iar acest acces poate fi revocat din setările extensiei Chrome. Operațiunile pe care le inițiezi se pot finaliza după închiderea ferestrei pop-up sau a panoului lateral.

Preferințele, confirmările de acces la site-uri, identificatorii favoritelor (fără valorile elementelor), stările salvate și rezumatele istoricului rămân în memoria locală a extensiei. Stările salvate pot conține valorile cookie-urilor și ale memoriei pe care alegeți în mod explicit să le salvați. Valorile complete „înainte/după” și datele de recuperare a operațiunilor rămân doar pe durata sesiunii curente a browserului; repornirea Chrome sau reîncărcarea extensiei le șterge. Ștergeți datele extensiei sau dezinstalați extensia pentru a elimina datele extensiei salvate local.

Cookie-urile și spațiul de stocare web pot conține informații de autentificare sau alte valori sensibile. Protejați datele copiate și exportate. Instrumentul JWT afișează conținutul decodat în format Base64URL doar în scopul verificării. Acesta nu verifică semnăturile și nu verifică dacă un token de autentificare este de încredere sau valid. Citiți [politica de confidențialitate](../../docs/privacy-policy.html) pentru detalii.

## Dezvoltarea de software

Instalați dependențele de dezvoltare și rulați verificările din directorul rădăcină al depozitului:

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

Ultima comandă testează citirea și modificarea datelor Local Storage și Session Storage ale unui site web în Chromium. Consultați [ghidul de referință pentru dezvoltare și lansare (în limba engleză)](../../docs/development.md) pentru a afla toate comenzile de testare a browserului, locațiile de ieșire și detalii privind fiabilitatea funcționării.

## Lansare și documentație

Versiunea actuală: **0.3.7**. Necesită **Chrome 114 sau o versiune mai recentă**.

- [Note de lansare v0.3.7](../../docs/release-notes-v0.3.7.md)
- [Întreținerea localizării](../../docs/localization.md)
- [Formatul pachetului de date al site-ului cu versiuni](../../docs/site-data-package-v1.md)
- [Descrieri ale produselor și imagini promoționale pentru magazinul online Chrome](../../store-assets/)
- [Raportează o problemă](https://github.com/Atimynyc/cookies-manager/issues)
