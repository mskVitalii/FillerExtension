Слушай, у нас проблема при публикации. Нам нужно что-то конкретное указать в тестовых инструкциях

Да. Тогда я бы прямо дал им конкретный URL и пошаговый сценарий, чтобы убрать формулировку “not reproducible”.

Можно написать в **Test instructions** так:

### Test instructions

The extension is designed to fill job application forms.

Please use the following job application page for testing:

[INSERT DIRECT JOB APPLICATION URL HERE]

Steps:

1. Open the job application page above.
2. Click the Filler extension icon.
3. The extension will detect the available form fields.
4. Use the extension to fill the form with the provided test profile data.
5. Verify that the form fields are populated.

The extension does not extract job postings from arbitrary websites. The “extract job posting” functionality refers to extracting job information from a supported job posting page in order to assist with the application process.

Please use the URL above when testing the job-posting extraction functionality.

Но я бы **обязательно изменил и Store description**. Сейчас:

> It just fills the forms for job applications. So, test it on any job form

противоречит их rejection `"To extract job postings"`.

Лучше:

Filler helps automate job applications by detecting and filling fields in job application forms.

It can extract relevant information from supported job postings and use it to assist with completing the corresponding application form.

To test the extension, open a supported job posting or job application page and click the Filler extension icon.

И главное: если ты хочешь, чтобы я дал им **конкретную страницу, на которой они гарантированно смогут проверить extraction**, скинь мне URL страницы вакансии/формы, на которой сейчас работает Filler. Я сформулирую Test instructions именно под неё.


Мб для верности давай нашу страницу опубликуем на моём сайте и будем её заполнять?

Твоя задава подготовить инстуркции и дать мне необходимые шаги