# Handproben, NICHT Teil der Testsuite

Diese Dateien laufen gegen ECHTE fremde Schnittstellen (Stripe im Testmodus)
und brauchen Zugangsdaten aus der Umgebung. Sie gehören bewusst nicht in
`npm test`: ein Testlauf darf ohne Netz und ohne fremde Konten grün sein.

Aufruf von Hand:

    npx tsx tests/manual/probe-connect.ts

Der Sinn: Unit-Tests haben die Abkündigung von Stripes Accounts v1 nicht
gesehen, weil sie kein Netz berühren. Diese Proben sehen sie.
