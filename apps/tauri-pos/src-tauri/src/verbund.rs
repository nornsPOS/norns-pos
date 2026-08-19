//! verbund — die Kasse und ihr Motor sterben gemeinsam.
//!
//! ── DER BEFUND ──────────────────────────────────────────────────────────────
//!
//! Auf Windows stellt niemand ein Signal zu. `Child::kill()` ist nichts als
//! `TerminateProcess`, und `TerminateProcess` trifft GENAU einen Prozess: den,
//! dessen Kennung man hält. Unser Motor ist aber eine Kette —
//!
//! ```text
//! Kasse (dieser Rumpf)
//!   └── norns-sidecar.exe  (der Node-Läufer)
//!         └── postgres.exe (und dessen eigene Kinder)
//! ```
//!
//! — und `anhalten()` in `motor.rs` beendet davon nur das mittlere Glied.
//! Postgres überlebt, hält das Datenverzeichnis gesperrt, und am nächsten
//! Morgen kommt die Kasse nicht mehr hoch. Der Händler sieht keinen Fehler, den
//! er versteht; er sieht eine Kasse, die nicht startet, mit Kundschaft davor.
//!
//! Schlimmer: bei einem harten Ende des Rumpfes (Absturz, Task-Manager,
//! Abmeldung, Stromausfall der Sitzung) läuft `anhalten()` überhaupt nicht. Ein
//! Aufräumer im Programm kann nicht aufräumen, wenn das Programm nicht mehr da
//! ist.
//!
//! ── DIE ZWEI WÄNDE ──────────────────────────────────────────────────────────
//!
//! Sitzung A hat die erste gebaut, im Dienst: `waisenErloesen()` liest beim
//! Start `postmaster.pid`, prüft, ob der Prozess noch lebt, und beendet ihn.
//! Das ist die Wand, die AUFRÄUMT, nachdem es schiefging.
//!
//! Dies ist die zweite, und sie ist die bessere: sie lässt es gar nicht erst
//! schiefgehen. Windows kennt dafür das Job-Objekt. Man legt einen Verbund an,
//! setzt darauf `KILL_ON_JOB_CLOSE`, steckt den Läufer hinein — und ab da
//! gehören ALLE seine Nachkommen mit dazu, ohne dass wir sie kennen müssen.
//!
//! Stirbt der Rumpf, schliesst Windows selbst dessen Kennungen. Damit fällt die
//! letzte Kennung auf den Verbund weg, und das Betriebssystem beendet, was noch
//! darin läuft. Es braucht keinen Code von uns, der zum Zeitpunkt des Absturzes
//! noch laufen müsste — und genau das ist der Punkt. Ein Aufräumer, der beim
//! Absturz mit abstürzt, ist kein Aufräumer.
//!
//! Beide Wände sind absichtlich da. Die eine deckt den Absturz, die andere den
//! Stromausfall und das Ende per Task-Manager. Keine ersetzt die andere.
//!
//! ── DIE KENNUNG MUSS LEBEN ──────────────────────────────────────────────────
//!
//! Die Kennung auf den Verbund liegt in einem `static` und wird NIE geschlossen.
//! Das ist kein Versehen: schlösse man sie, während die Kasse noch läuft, fiele
//! genau die Wand, und Windows beendete den Motor mitten im Verkauf. Beim Ende
//! des Prozesses räumt das Betriebssystem sie ohnehin ab, und das ist exakt der
//! Moment, in dem sie greifen soll.
//!
//! ── AUF MAC UND LINUX ───────────────────────────────────────────────────────
//!
//! Dort tut diese Datei nichts, und sie sagt es auch. Der Händler läuft auf
//! Windows; die Entwicklung läuft hier. Ein `unerreichbar`-Zweig, der so tut,
//! als hätte er etwas geschützt, wäre eine Lüge an genau der Stelle, an der man
//! sie nie bemerkt.

/// Was der Versuch ergeben hat. Bewusst dreiwertig: „hier gibt es das nicht"
/// und „es hat nicht geklappt" sind NICHT dasselbe, und wer beides als `false`
/// zurückbekäme, könnte sie nicht auseinanderhalten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verbundlage {
    /// Der Verbund steht. Nachkommen sterben mit dem Rumpf.
    Gebunden,
    /// Dieses Betriebssystem kennt keine Job-Objekte. Kein Fehler.
    NichtAufDiesemSystem,
    /// Windows, aber es ging schief. Die erste Wand (Sitzung A) trägt allein.
    Gescheitert,
}

#[cfg(windows)]
mod win {
    use super::Verbundlage;
    use std::sync::OnceLock;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Die Kennung auf den Verbund, für die Lebensdauer des Prozesses.
    ///
    /// `usize` statt `HANDLE`, weil `HANDLE` nicht `Send`/`Sync` ist. Der Wert
    /// ist dieselbe Zahl; wir geben sie nie wieder her, wir halten sie nur.
    static VERBUND: OnceLock<usize> = OnceLock::new();

    /// Den Verbund anlegen, einmalig.
    fn verbund() -> Option<HANDLE> {
        let roh = VERBUND.get_or_init(|| unsafe {
            let Ok(job) = CreateJobObjectW(None, windows::core::PCWSTR::null()) else {
                return 0;
            };

            // Der ganze Zweck: fällt die letzte Kennung weg, beendet Windows
            // alles, was noch im Verbund läuft.
            let mut grenzen = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            grenzen.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &grenzen as *const _ as *const core::ffi::c_void,
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(0),
            )
            .is_err()
            {
                // Ein Verbund OHNE diese Grenze wäre schlimmer als keiner: er
                // sähe nach Schutz aus und wäre keiner. Also weg damit.
                let _ = CloseHandle(job);
                return 0;
            }
            job.0 as usize
        });
        if *roh == 0 {
            None
        } else {
            Some(HANDLE(*roh as *mut core::ffi::c_void))
        }
    }

    /// Einen laufenden Prozess in den Verbund holen.
    pub fn binden(pid: u32) -> Verbundlage {
        let Some(job) = verbund() else {
            return Verbundlage::Gescheitert;
        };
        unsafe {
            // Genau die zwei Rechte, die `AssignProcessToJobObject` verlangt.
            // Mehr zu erbitten wäre unnötig und würde bei knappen Rechten
            // scheitern, wo es nicht müsste.
            let Ok(prozess) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) else {
                return Verbundlage::Gescheitert;
            };
            let lage = if AssignProcessToJobObject(job, prozess).is_ok() {
                Verbundlage::Gebunden
            } else {
                // Seit Windows 8 sind geschachtelte Verbünde erlaubt, deshalb
                // ist das hier selten. Wenn doch: die erste Wand trägt.
                Verbundlage::Gescheitert
            };
            // Die Kennung auf den PROZESS darf zu, die auf den VERBUND nicht.
            // Die Mitgliedschaft hängt nicht an ihr.
            let _ = CloseHandle(prozess);
            lage
        }
    }
}

/// Den Motorprozess an das Leben dieser Kasse knüpfen.
///
/// Ruft der Rumpf das für den Läufer auf, gilt es für dessen ganze Nachkommen —
/// also auch für Postgres, das wir nie selbst in der Hand haben.
#[cfg(windows)]
pub fn an_die_kasse_binden(pid: u32) -> Verbundlage {
    win::binden(pid)
}

/// Auf Mac und Linux gibt es keine Job-Objekte. Hier räumt der Ordnungsweg von
/// Sitzung A auf; dieser Zweig behauptet ausdrücklich KEINEN Schutz.
#[cfg(not(windows))]
pub fn an_die_kasse_binden(_pid: u32) -> Verbundlage {
    Verbundlage::NichtAufDiesemSystem
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Der Zweig für dieses Entwicklungsgerät sagt die Wahrheit über sich.
    ///
    /// Der Test ist klein, und er ist trotzdem der wichtige: er hält fest, dass
    /// hier NICHT geschützt wird. Gäbe er `Gebunden` zurück, läse sich jeder
    /// Lauf auf diesem Mac wie ein Beweis für etwas, das nur auf Windows
    /// existiert.
    #[test]
    #[cfg(not(windows))]
    fn ausserhalb_von_windows_wird_kein_schutz_behauptet() {
        assert_eq!(
            an_die_kasse_binden(std::process::id()),
            Verbundlage::NichtAufDiesemSystem,
        );
    }

    /// `Gescheitert` und `NichtAufDiesemSystem` dürfen nie zusammenfallen.
    #[test]
    fn die_drei_lagen_sind_unterscheidbar() {
        assert_ne!(Verbundlage::Gescheitert, Verbundlage::NichtAufDiesemSystem);
        assert_ne!(Verbundlage::Gebunden, Verbundlage::Gescheitert);
    }
}
