1. Должен быть список переменных, которые будут задаваться по дефолту (город, ключевики итд). Но наша задача не создавать эти переменные из CV специально - наша задача только вытащить их

2. Расширение при загрузке PDF как будто делает из него MD и потом из MD воссоздаёт PDF. Вместо того, чтобы копировать PDF и заполнять его переменные 

Мы не делаем CV с 0, мы только лишь заполняем переменные

3. Давай работать также с tex файлами, всё же там можно с 0 собрать нужное (тут ещё дополнительная сложность, что надо работать с картинками / доп файлами, из которых CV крафтится)

4. Эта фича слабо непонятная людям -- нам нужно показать пример
"""
Template syntax
# Full Name                  → title (first line)
## Section                    → section heading
### Role, Company || 2021 – now  → entry heading, text after " || " is right-aligned
- bullet point                (indent 2 spaces for a nested one)
---                           → horizontal rule
plain line                    → one line of text (also accepts "left || right")
(blank line)                  → small gap
**bold**  *italic*  [label](https://…)  \*literal asterisk
{{variable}}                  → replaced per job posting
A variant can be several lines — e.g. a {{go_bullets}} placeholder whose variants are whole blocks of bullet points, one per stack.
"""
Вместо этого всего нам нужен только пример на переменную
Position: Software Engineer
Location: Chemnitz, Germany

CV template:
{{city}} -> Chemnitz
{{position}} -> Software Engineer
Подумай как лучше объяснить мб схемку из 2-х блоков сделать (template, CV)