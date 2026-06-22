# Vocabolario fonico Airtable

App web per mostrare un vocabolario fonico online usando Airtable come archivio e gli mp3 caricati in Airtable come attachment.

## Campi attesi in Airtable

La base collegata usa la tabella `Lessico aquiloniese` con questi campi:

- `Lemma`: parola o lemma
- `Significato`: definizione o nota
- `Pronuncia`: campo attachment con uno o piu file mp3
- `Inglese`: traduzione o glossario in inglese
- `Campo semantico`: collegamento ai campi semantici
- `Grammatica`: valore mostrato solo nella tessera ingrandita
- `Etimologia`: valore mostrato solo nella tessera ingrandita
- `Immagine`: attachment mostrato solo nella tessera ingrandita

L'app puo usare anche questi campi se li aggiungi o li rinomini nel file `.env`:

- `Phonetic`: trascrizione fonetica
- `Language`: lingua
- `Category`: categoria

## Configurazione

1. Duplica `.env.example` in `.env`.
2. Inserisci:
   - `AIRTABLE_TOKEN`: il token segreto completo, non il Token ID visibile nella lista dei token.
   - `AIRTABLE_BASE_ID`: gia impostato su `appV4KvPG7wmYJ9ju`, ricavato dal link condiviso.
3. La configurazione locale e gia impostata su tabella `Lessico aquiloniese`, campo lemma `Lemma`, significato `Significato`, audio `Pronuncia`.
4. Se cambi struttura in Airtable, aggiorna i campi `AIRTABLE_*_FIELD`.

Il link che hai fornito e:

```text
https://airtable.com/appV4KvPG7wmYJ9ju/shrzlbk133YzPEfKv
```

La parte `shrzlbk133YzPEfKv` identifica la vista condivisa, ma non basta per chiamare le API Airtable. Per questo l'app usa il base id e un token privato lato server.

Attenzione: nella schermata Airtable "Developer hub" la colonna `TOKEN ID` mostra solo l'identificativo del token, per esempio `patw3TdXW3cPjsTI6`. Non e il token segreto. Se non hai copiato il valore segreto quando il token e stato creato, devi rigenerarlo o crearne uno nuovo.

## Verifica collegamento

Con il token corretto, l'app ha letto 3.733 lemmi dalla tabella `Lessico aquiloniese`; 3.709 hanno almeno un file audio in `Pronuncia`.

## Avvio

```bash
npm start
```

Poi apri `http://localhost:4173`.

## Note sugli attachment mp3

Airtable restituisce URL temporanei per gli attachment. L'app interroga Airtable tramite il server ogni volta che carica il vocabolario, cosi gli indirizzi degli mp3 vengono presi freschi e il token Airtable non finisce nel browser.
