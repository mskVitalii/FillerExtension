Итак, запилим новый кусок функционала

# A. Разберёмся с выпадающими полями
Часто мы генерируем ответ на поле, в котором варианты ответов предопределены

Давай обрабатывать options

<label for="cars">Choose a car:</label>
<select id="cars" name="cars">
  <option value="volvo">Volvo</option>
  <option value="saab">Saab</option>
  <option value="fiat">Fiat</option>
  <option value="audi">Audi</option>
</select>

  <input list="browsers">
  <datalist id="browsers">
    <option value="Edge">
    <option value="Firefox">
    <option value="Chrome">
    <option value="Opera">
    <option value="Safari">
  </datalist>


И в некоторых вакансиях нет этих options, но есть сигнал, что поле подразумевает варианты ответа - давай нажимать на поле через браузерный ивент и если у него будут варианты ответа, то в chatGPT загонять это всё и пускай оно даёт ответ (или строить структурированный запрос если данные определены)

---

# B. FAQ
Мы сталкиваемся с банальными вопросами при заполнении заявок на вакансии. Нам стоит подготовить вразумительные ответы и включить их в промпт. Твоя задача если их нет - сгенерить по CV и легенде

Список вопросов:

"""
About You

1. Tell me about yourself.

Brief, confident summary — work experience, key skills, career goals. Not your life story.

"I'm a marketing specialist with 5 years in digital campaigns, passionate about data-driven strategies, looking to grow in a leadership role."

2. What are your strengths?

Pick 2–3 strengths relevant to the job, back them up with short examples.

"I'm detail-oriented and proactive. I recently caught an error in a product launch plan that saved $50K."

3. What is your biggest weakness?

Name a real, minor weakness and show how you're improving.

"I used to overcommit to projects, but now I prioritize better and set clearer boundaries."

4. How do you handle stress or pressure?

Show resilience with a real technique.

"I break tasks down, prioritize, and stay focused. Tight deadlines were common, and I consistently delivered ahead of schedule."

5. Why are you leaving your current job?

Stay positive — focus on growth, not complaints.

"I'm looking for a new challenge where I can expand my project management skills and take on greater responsibility."

Skills & Experience

6. Tell me about a time you faced a challenge at work.

Use the STAR format: Situation → Task → Action → Result.

"A project fell behind. I reorganized the team schedule, added a check-in system, and we delivered on time."

7. What skills make you a good fit for this position?

Tie your top skills directly to the job description.

"My experience in CRM systems, client negotiation, and sales forecasting directly match your requirements."

8. How do you stay updated with industry trends?

Show initiative and continuous learning.

"I subscribe to key industry newsletters, attend webinars, and am part of a professional network that shares best practices."

9. Have you ever had to learn a new skill quickly?

Give a real example with specifics.

"I had to master a new inventory system in two weeks; I set up a personal study schedule and shadowed a senior team member."

10. What do you know about our company?

Do your homework — mention specifics about their products, mission, or recent news.

"You're a leading innovator in the fintech space, recently launching [product]. I'm impressed by your commitment to customer-centric solutions."

Goals & Motivation

11. Why do you want this job?

Connect your personal goals to the specific role and company.

"I'm excited about the opportunity to drive new marketing strategies here and develop my leadership skills in a growing company."

12. Where do you see yourself in five years?

Balance ambition with realism.

"I see myself mastering this role, taking on leadership responsibilities, and contributing to strategic decision-making."

13. What motivates you to do your best work?

Be authentic and tie it to the company's mission.

"Solving problems that make customers' lives easier really drives me — your company's focus on innovation is a perfect match."

14. What are your salary expectations?

Be prepared but flexible. Research market rates beforehand.

"Based on my research and experience, I'm targeting $X–$Y range but am open to discussing based on the overall package."

15. How do you define success?

Keep it professional and outcome-oriented.

"Delivering measurable results, growing my skills, and contributing positively to my team's goals."

16. Do you have any questions for us?

Always say yes. Prepare smart questions that show genuine interest.

"How do you define success for this role?" or "What are the biggest challenges the team is facing right now?"

Problem-Solving

17. How do you approach solving a complex problem?

Show you break problems down logically.

"I analyze the root cause, break it into smaller pieces, prioritize by impact, and test solutions quickly."

18. Describe a time you had to make a quick decision.

Emphasize clarity and decisive action under pressure.

"During a production outage, I assessed system logs, identified a failing service, and initiated a rollback within 15 minutes."

19. Tell me about a time you disagreed with a team decision.

Show professionalism — raise concerns with data, support the final outcome.

"I raised my concerns with data-backed points during a team meeting, but supported the final group decision once aligned."

20. How do you handle situations with incomplete information?

Show adaptability and sound judgment.

"I gather as much relevant data as quickly as possible, make an informed best-guess decision, and iterate based on feedback."

21. What's an example of an innovative solution you proposed?

Share a specific, measurable win.

"I suggested automating our nightly deployment scripts, which cut downtime by 30% and reduced human error."


"""

--- 

# С. Давай запилим новую вкладку поиска работы

Мы сделаем это 3-мя способами:
1. через openai API (мб пускай она использует поиск по интернету) -- дай вакансии
2. Tavily поиск (если пользователь введёт токен)
3. через API https://developer.adzuna.com/ при вводе app_key and app_id (тут надо ставить настройки какие есть в доке, но пускай они автозаполняются по CV, если пустые)
За документацией зайди на страницу https://developer.adzuna.com/overview
(оставь людям ссылку на доку, как это всё получить)