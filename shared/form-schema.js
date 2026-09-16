// scope: shared
/* The 11-step application form (main spec §6): steps, questions, answer lists, EN/TA text.
   Pure data plus lookups. Behaviour (show-if, checks, progress) lives in form-rules.js.
   Field ids are Sheet/D1 column names: never rename one once real data exists. */
var SC_FormSchema = (function () {
  "use strict";

  var VERSION = 1;

  function opt(value, en, ta) {
    return { value: value, en: en, ta: ta };
  }

  function q(id, type, en, ta, extra) {
    return Object.assign({ id: id, type: type, en: en, ta: ta, required: false }, extra || {});
  }

  var OPTIONS = {
    CENTRE: [opt("TVM", "Thiruvanmiyur", "திருவான்மியூர்"), opt("VLC", "Velachery", "வேளச்சேரி"), opt("TDP", "Tondiarpet", "தண்டையார்பேட்டை"), opt("SLR", "Selaiyur", "சேலையூர்")],
    HEARD_FROM: [opt("DOCTOR", "Doctor", "மருத்துவர்"), opt("SCHOOL", "School", "பள்ளி"), opt("PARENT", "Another parent", "மற்றொரு பெற்றோர்"), opt("INTERNET", "Internet", "இணையம்"), opt("OTHER", "Other", "மற்றவை")],
    PROGRAMS: [
      opt("SPECIAL_EDUCATION", "Special Education", "சிறப்புக் கல்வி"),
      opt("VOCATIONAL", "Vocational Training", "தொழிற்பயிற்சி"),
      opt("OCCUPATIONAL_THERAPY", "Occupational Therapy", "தொழில்சார் சிகிச்சை"),
      opt("SPEECH_THERAPY", "Speech Therapy", "பேச்சு சிகிச்சை"),
      opt("YOGA", "Yoga Therapy", "யோகா சிகிச்சை"),
      opt("PLAY", "Play Therapy", "விளையாட்டு சிகிச்சை"),
      opt("DANCE", "Dance Therapy", "நடன சிகிச்சை"),
      opt("LIFE_SKILLS", "Life Skill Training", "வாழ்க்கைத் திறன் பயிற்சி"),
      opt("SPORTS", "Sports", "விளையாட்டுகள்"),
      opt("ASSISTED_EMPLOYMENT", "Assisted Employment", "உதவியுடன் வேலைவாய்ப்பு"),
    ],
    GENDER: [opt("MALE", "Male", "ஆண்"), opt("FEMALE", "Female", "பெண்"), opt("OTHER", "Other", "மற்றவை")],
    UDID: [opt("HAVE", "Have", "உள்ளது"), opt("APPLIED", "Applied", "விண்ணப்பித்துள்ளோம்"), opt("NO", "No", "இல்லை")],
    YES_NO: [opt("YES", "Yes", "ஆம்"), opt("NO", "No", "இல்லை")],
    RELATIONSHIP: [opt("MOTHER", "Mother", "தாய்"), opt("FATHER", "Father", "தந்தை"), opt("GUARDIAN", "Guardian", "பாதுகாவலர்")],
    INCOME: [
      opt("BELOW_10K", "Below ₹10,000", "₹10,000-க்குக் கீழ்"),
      opt("FROM_10K_TO_25K", "₹10,000 – ₹25,000", "₹10,000 – ₹25,000"),
      opt("FROM_25K_TO_50K", "₹25,000 – ₹50,000", "₹25,000 – ₹50,000"),
      opt("ABOVE_50K", "Above ₹50,000", "₹50,000-க்கு மேல்"),
      opt("NOT_SAID", "Prefer not to say", "சொல்ல விரும்பவில்லை"),
    ],
    ASD: [opt("YES", "Yes", "ஆம்"), opt("NO", "No", "இல்லை"), opt("SUSPECTED", "Suspected", "சந்தேகம் உள்ளது")],
    CONDITIONS: [
      opt("ADHD", "ADHD", "ADHD (கவனக்குறைவு மிகைச்செயல்பாடு)"),
      opt("INTELLECTUAL", "Intellectual disability", "அறிவுசார் குறைபாடு"),
      opt("EPILEPSY", "Epilepsy / seizures", "வலிப்பு நோய்"),
      opt("CEREBRAL_PALSY", "Cerebral palsy", "மூளை முடக்குவாதம்"),
      opt("HEARING", "Hearing difficulty", "செவித்திறன் குறைபாடு"),
      opt("VISION", "Vision difficulty", "பார்வைக் குறைபாடு"),
      opt("DOWN_SYNDROME", "Down syndrome", "டவுன் சிண்ட்ரோம்"),
      opt("OTHER", "Other", "மற்றவை"),
    ],
    ASSESSMENT_TOOL: [opt("CARS", "CARS", "CARS"), opt("ISAA", "ISAA", "ISAA"), opt("IQ", "IQ test", "IQ சோதனை"), opt("OTHER", "Other", "மற்றவை"), opt("NONE", "None yet", "இன்னும் இல்லை")],
    BIRTH_TERM: [opt("FULL_TERM", "Full term", "முழுக் காலப் பிரசவம்"), opt("PRETERM", "Early (preterm)", "குறைப் பிரசவம்")],
    MILESTONE: [opt("ON_TIME", "On time", "சரியான நேரத்தில்"), opt("DELAYED", "Delayed", "தாமதமாக"), opt("NOT_YET", "Not yet", "இன்னும் இல்லை")],
    COMMUNICATION: [
      opt("SENTENCES", "Speaks in sentences", "வாக்கியங்களில் பேசுகிறார்"),
      opt("FEW_WORDS", "Uses a few words", "சில வார்த்தைகள் பேசுகிறார்"),
      opt("NON_VERBAL", "Does not speak yet", "இன்னும் பேசவில்லை"),
      opt("GESTURES", "Uses gestures", "சைகைகள் மூலம்"),
      opt("AAC", "Picture board or device (AAC)", "படப் பலகை அல்லது கருவி (AAC)"),
    ],
    ABILITY: [opt("INDEPENDENT", "Independently", "தானாக"), opt("WITH_HELP", "With help", "உதவியுடன்"), opt("NOT_YET", "Not yet", "இன்னும் இல்லை")],
    FREQUENCY: [opt("NEVER", "Never", "ஒருபோதும் இல்லை"), opt("SOMETIMES", "Sometimes", "சில நேரங்களில்"), opt("OFTEN", "Often", "அடிக்கடி")],
    SUITABILITY: [
      opt("SUITABLE", "Suitable", "பொருத்தமானவர்"),
      opt("NEEDS_ASSESSMENT", "Needs further assessment", "மேலும் மதிப்பீடு தேவை"),
      opt("NOT_SUITABLE", "Not suitable for our programs", "எங்கள் திட்டங்களுக்குப் பொருத்தமில்லை"),
    ],
    PRIORITY: [opt("NORMAL", "Normal", "சாதாரணம்"), opt("URGENT", "Urgent", "அவசரம்")],
  };

  var HAVE_UDID = { field: "s2_udid_status", equals: "HAVE" };
  var ASD_YES = { field: "s4_asd_diagnosed", equals: "YES" };

  var STEPS = [
    { id: "s1", en: "Centre & enquiry", ta: "மையம் மற்றும் விசாரணை", fields: [
      q("s1_centre", "choice", "Centre", "மையம்", { required: true, options: "CENTRE" }),
      q("s1_enquiry_date", "date", "Enquiry date", "விசாரணை தேதி", { required: true, noFuture: true }),
      q("s1_heard_from", "choice", "How did you hear about us?", "எங்களைப் பற்றி எப்படித் தெரிந்துகொண்டீர்கள்?", { options: "HEARD_FROM" }),
      q("s1_programs", "multi", "Programs of interest", "ஆர்வமுள்ள திட்டங்கள்", { options: "PROGRAMS" }),
    ] },
    { id: "s2", en: "Applicant details", ta: "விண்ணப்பதாரர் விவரங்கள்", fields: [
      q("s2_full_name", "text", "Full name", "முழுப் பெயர்", { required: true }),
      q("s2_name_ta", "text", "Name in Tamil", "தமிழில் பெயர்"),
      q("s2_dob", "date", "Date of birth", "பிறந்த தேதி", { required: true, noFuture: true }),
      q("s2_gender", "choice", "Gender", "பாலினம்", { required: true, options: "GENDER" }),
      q("s2_mother_tongue", "text", "Mother tongue", "தாய்மொழி"),
      q("s2_home_languages", "text", "Languages spoken at home", "வீட்டில் பேசும் மொழிகள்"),
      q("s2_photo", "file", "Photo", "புகைப்படம்", { kind: "PHOTO", maxFiles: 1 }),
      q("s2_udid_status", "choice", "UDID / disability card", "UDID / மாற்றுத்திறனாளி அட்டை", { options: "UDID" }),
      q("s2_udid_number", "text", "UDID number", "UDID எண்", { showIf: HAVE_UDID }),
      q("s2_udid_percent", "number", "Disability percentage", "மாற்றுத்திறன் சதவீதம்", { min: 0, max: 100, showIf: HAVE_UDID }),
      q("s2_aadhaar_available", "choice", "Aadhaar card available?", "ஆதார் அட்டை உள்ளதா?", { options: "YES_NO" }),
    ] },
    { id: "s3", en: "Parent / guardian", ta: "பெற்றோர் / பாதுகாவலர் விவரங்கள்", fields: [
      q("s3_father_name", "text", "Father's name", "தந்தையின் பெயர்"),
      q("s3_father_occupation", "text", "Father's occupation", "தந்தையின் தொழில்"),
      q("s3_mother_name", "text", "Mother's name", "தாயின் பெயர்"),
      q("s3_mother_occupation", "text", "Mother's occupation", "தாயின் தொழில்"),
      q("s3_guardian_name", "text", "Guardian's name (if not a parent)", "பாதுகாவலர் பெயர் (பெற்றோர் இல்லையெனில்)"),
      q("s3_guardian_relation", "text", "Guardian's relationship to the applicant", "விண்ணப்பதாரருடன் பாதுகாவலரின் உறவு", { showIf: { field: "s3_guardian_name", filled: true } }),
      q("s3_primary_contact", "choice", "Main person to contact", "முதன்மைத் தொடர்பு நபர்", { required: true, options: "RELATIONSHIP" }),
      q("s3_primary_phone", "phone", "Main phone number", "முதன்மைத் தொலைபேசி எண்", { required: true }),
      q("s3_alternate_phone", "phone", "Other phone number", "மற்றொரு தொலைபேசி எண்"),
      q("s3_whatsapp", "phone", "WhatsApp number", "WhatsApp எண்"),
      q("s3_address", "textarea", "Address", "முகவரி", { required: true }),
      q("s3_area", "text", "Area", "பகுதி"),
      q("s3_pincode", "pincode", "Pincode", "அஞ்சல் குறியீடு"),
      q("s3_income", "choice", "Monthly family income", "மாதாந்திரக் குடும்ப வருமானம்", { options: "INCOME" }),
      q("s3_siblings", "number", "Number of brothers and sisters", "உடன்பிறந்தவர்களின் எண்ணிக்கை", { min: 0, max: 15 }),
      q("s3_sibling_disability", "choice", "Does a brother or sister have a disability?", "உடன்பிறந்தவர்களில் யாருக்காவது மாற்றுத்திறன் உள்ளதா?", { options: "YES_NO", showIf: { field: "s3_siblings", greaterThan: 0 } }),
    ] },
    { id: "s4", en: "Diagnosis & medical", ta: "நோயறிதல் மற்றும் மருத்துவ வரலாறு", fields: [
      q("s4_asd_diagnosed", "choice", "Has autism been diagnosed?", "ஆட்டிசம் கண்டறியப்பட்டுள்ளதா?", { required: true, options: "ASD" }),
      q("s4_diagnosed_by", "text", "Diagnosed by (doctor or hospital)", "கண்டறிந்தவர் (மருத்துவர் அல்லது மருத்துவமனை)", { showIf: ASD_YES }),
      q("s4_diagnosis_age", "number", "Age at diagnosis (years)", "கண்டறியப்பட்ட வயது (ஆண்டுகள்)", { min: 0, max: 60, showIf: ASD_YES }),
      q("s4_conditions", "multi", "Other conditions", "பிற உடல்நிலைகள்", { options: "CONDITIONS" }),
      q("s4_conditions_other", "text", "Other condition, please describe", "பிற உடல்நிலை, விவரிக்கவும்", { showIf: { field: "s4_conditions", includes: "OTHER" } }),
      q("s4_medicines", "textarea", "Current medicines", "தற்போதைய மருந்துகள்"),
      q("s4_allergies", "text", "Allergies", "ஒவ்வாமைகள்"),
      q("s4_assessment_tool", "choice", "Previous assessment", "முந்தைய மதிப்பீடு", { options: "ASSESSMENT_TOOL" }),
      q("s4_assessment_score", "text", "Assessment score", "மதிப்பீட்டு மதிப்பெண்", { showIf: { field: "s4_assessment_tool", equals: ["CARS", "ISAA", "IQ", "OTHER"] } }),
      q("s4_diagnosis_report", "file", "Diagnosis report (PDF or photo)", "நோயறிதல் அறிக்கை (PDF அல்லது புகைப்படம்)", { kind: "DIAGNOSIS", maxFiles: 3 }),
    ] },
    { id: "s5", en: "Development", ta: "வளர்ச்சி வரலாறு", fields: [
      q("s5_birth_term", "choice", "Birth", "பிறப்பு", { options: "BIRTH_TERM" }),
      q("s5_birth_complications", "choice", "Any problems at birth?", "பிறப்பின்போது ஏதேனும் சிக்கல்கள்?", { options: "YES_NO" }),
      q("s5_complications_note", "text", "What happened at birth?", "பிறப்பின்போது என்ன நடந்தது?", { showIf: { field: "s5_birth_complications", equals: "YES" } }),
      q("s5_birth_weight", "number", "Birth weight (kg)", "பிறப்பு எடை (கிலோ)", { min: 0.3, max: 7, decimals: true }),
      q("s5_neck_holding", "choice", "Holding the head up", "தலை நிற்றல்", { options: "MILESTONE" }),
      q("s5_sitting", "choice", "Sitting", "உட்காருதல்", { options: "MILESTONE" }),
      q("s5_walking", "choice", "Walking", "நடத்தல்", { options: "MILESTONE" }),
      q("s5_first_words", "choice", "First words", "முதல் வார்த்தைகள்", { options: "MILESTONE" }),
      q("s5_toilet_training", "choice", "Toilet training", "கழிப்பறைப் பயிற்சி", { options: "MILESTONE" }),
    ] },
    { id: "s6", en: "Current abilities", ta: "தற்போதைய திறன்கள்", fields: [
      q("s6_communication", "choice", "How does the applicant communicate?", "விண்ணப்பதாரர் எப்படித் தொடர்பு கொள்கிறார்?", { options: "COMMUNICATION" }),
      q("s6_eye_contact", "choice", "Makes eye contact", "கண் பார்த்துப் பேசுதல்", { options: "FREQUENCY" }),
      q("s6_responds_to_name", "choice", "Responds to name", "பெயர் சொன்னால் திரும்புதல்", { options: "ABILITY" }),
      q("s6_follows_instructions", "choice", "Follows simple instructions", "எளிய அறிவுறுத்தல்களைப் பின்பற்றுதல்", { options: "ABILITY" }),
      q("s6_eating", "choice", "Eating", "சாப்பிடுதல்", { options: "ABILITY" }),
      q("s6_toileting", "choice", "Toileting", "கழிப்பறை பயன்பாடு", { options: "ABILITY" }),
      q("s6_dressing", "choice", "Dressing", "உடை அணிதல்", { options: "ABILITY" }),
      q("s6_plays_with_others", "choice", "Plays with others", "மற்றவர்களுடன் விளையாடுதல்", { options: "FREQUENCY" }),
      q("s6_sleep_problems", "choice", "Sleep problems", "தூக்கப் பிரச்சினைகள்", { options: "FREQUENCY" }),
    ] },
    { id: "s7", en: "Behaviour & senses", ta: "நடத்தை மற்றும் புலன் உணர்வுகள்", fields: [
      q("s7_hyperactivity", "choice", "Very restless or overactive", "மிகுந்த அமைதியின்மை அல்லது மிகைச்செயல்பாடு", { options: "FREQUENCY" }),
      q("s7_aggression", "choice", "Hits or hurts others", "மற்றவர்களை அடித்தல் அல்லது காயப்படுத்துதல்", { options: "FREQUENCY" }),
      q("s7_self_injury", "choice", "Hurts self", "தன்னைத்தானே காயப்படுத்திக்கொள்ளுதல்", { options: "FREQUENCY", safety: true }),
      q("s7_tantrums", "choice", "Tantrums", "அடம்பிடித்தல்", { options: "FREQUENCY" }),
      q("s7_repetitive", "choice", "Repeats the same movements or actions", "ஒரே அசைவுகளை அல்லது செயல்களைத் திரும்பத் திரும்பச் செய்தல்", { options: "FREQUENCY" }),
      q("s7_sound_sensitivity", "choice", "Upset by sounds", "ஒலிகளால் தொந்தரவு அடைதல்", { options: "FREQUENCY" }),
      q("s7_touch_sensitivity", "choice", "Upset by touch", "தொடுதலால் தொந்தரவு அடைதல்", { options: "FREQUENCY" }),
      q("s7_light_sensitivity", "choice", "Upset by bright light", "பிரகாசமான ஒளியால் தொந்தரவு அடைதல்", { options: "FREQUENCY" }),
      q("s7_wandering", "choice", "Wanders off or runs away", "வெளியே சென்றுவிடுதல் அல்லது ஓடிவிடுதல்", { options: "FREQUENCY", safety: true }),
    ] },
    { id: "s8", en: "School, work & therapy", ta: "கல்வி, வேலை மற்றும் சிகிச்சை வரலாறு", fields: [
      q("s8_previous_schools", "textarea", "Previous schools", "முந்தைய பள்ளிகள்"),
      q("s8_current_therapies", "textarea", "Current therapies (what, where, how often)", "தற்போதைய சிகிச்சைகள் (என்ன, எங்கே, எத்தனை முறை)"),
      q("s8_work_experience", "textarea", "Work or vocational experience", "வேலை அல்லது தொழிற்பயிற்சி அனுபவம்", { showIf: { minAge: 18 } }),
    ] },
    { id: "s9", en: "Parent's concerns", ta: "பெற்றோரின் கவலைகள் மற்றும் எதிர்பார்ப்புகள்", fields: [
      q("s9_concerns", "textarea", "Main concerns", "முக்கியக் கவலைகள்"),
      q("s9_expectations", "textarea", "What they hope for from the school", "பள்ளியிடமிருந்து எதிர்பார்ப்பது"),
    ] },
    { id: "s10", en: "Therapist's recommendation", ta: "சிகிச்சையாளரின் கவனிப்புகள் மற்றும் பரிந்துரை", fields: [
      q("s10_observation", "textarea", "Your observations", "உங்கள் கவனிப்புகள்", { required: true }),
      q("s10_suitability", "choice", "Suitability", "பொருத்தம்", { required: true, options: "SUITABILITY" }),
      q("s10_recommended_programs", "multi", "Recommended programs", "பரிந்துரைக்கப்படும் திட்டங்கள்", { required: true, options: "PROGRAMS" }),
      q("s10_suggested_centre", "choice", "Suggested centre", "பரிந்துரைக்கப்படும் மையம்", { options: "CENTRE" }),
      q("s10_priority", "choice", "Priority", "முன்னுரிமை", { options: "PRIORITY" }),
    ] },
    { id: "s11", en: "Consent", ta: "ஒப்புதல்", fields: [
      q("s11_consent", "consent",
        "I agree that Swabodhini may keep the applicant's details, photos and reports to assess and support them. Only Swabodhini staff can see them. I can ask for them to be deleted.",
        "விண்ணப்பதாரரை மதிப்பீடு செய்யவும் ஆதரிக்கவும், அவரது விவரங்கள், புகைப்படங்கள் மற்றும் அறிக்கைகளை ஸ்வபோதினி வைத்திருக்க நான் ஒப்புக்கொள்கிறேன். ஸ்வபோதினி பணியாளர்கள் மட்டுமே இவற்றைப் பார்க்க முடியும். இவற்றை நீக்கச் சொல்லும் உரிமை எனக்கு உண்டு.",
        { required: true }),
      q("s11_parent_name", "text", "Parent / guardian name", "பெற்றோர் / பாதுகாவலர் பெயர்", { required: true }),
      q("s11_relationship", "choice", "Relationship", "உறவு", { required: true, options: "RELATIONSHIP" }),
      q("s11_signature", "signature", "Parent's signature", "பெற்றோரின் கையொப்பம்", { required: true, kind: "CONSENT_SIGNATURE" }),
    ] },
  ];

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) {
        deepFreeze(value[key]);
      });
      Object.freeze(value);
    }
    return value;
  }

  deepFreeze(OPTIONS);
  deepFreeze(STEPS);

  var ALL_FIELDS = Object.freeze(
    STEPS.reduce(function (acc, step) {
      return acc.concat(step.fields);
    }, [])
  );

  var FIELD_INDEX = ALL_FIELDS.reduce(function (acc, field) {
    acc[field.id] = field;
    return acc;
  }, {});

  function fieldById(id) {
    return Object.prototype.hasOwnProperty.call(FIELD_INDEX, id) ? FIELD_INDEX[id] : null;
  }

  function stepById(id) {
    return STEPS.find(function (step) { return step.id === id; }) || null;
  }

  function allFields() {
    return ALL_FIELDS;
  }

  function optionLabel(list, value, lang) {
    var found = (OPTIONS[list] || []).find(function (o) { return o.value === value; });
    return found ? found[lang === "ta" ? "ta" : "en"] : null;
  }

  return Object.freeze({
    VERSION: VERSION,
    OPTIONS: OPTIONS,
    STEPS: STEPS,
    fieldById: fieldById,
    stepById: stepById,
    allFields: allFields,
    optionLabel: optionLabel,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_FormSchema;
}
