version=2

# type=@perfdata:%{
#     "name": "perfdata",
#     "type": "repeat",
#     "parser": [
#         { "type": "char-to", "name": "name", "extradata": "=" },
#         { "type": "literal", "text": "=" },
# 
#         { "type": "char-to", "name": "value", "extradata": ";" },
#         { "type": "literal", "text": ";" },
# 
#         { "type": "number", "name": "warning" },
#         { "type": "literal", "text": ";" },
# 
#         { "type": "number", "name": "critical" },
#         { "type": "literal", "text": ";" },
# 
#         { "type": "number", "name": "min" },
#         { "type": "literal", "text": ";" },
# 
#         { "type": "number", "name": "max" }
# 
#     ],
#     "while": [
#         { "type": "whitespace" }
#     ] }%

prefix=%[
    { "type": "literal",    "text": "[" },
    { "type": "number",     "name": "datetime_reported", "format": "number" },
    { "type": "literal",    "text": "]" },
    { "type": "whitespace" },

    { "type": "literal",    "text": "PROCESS_SERVICE_CHECK_RESULT;" },

    { "type": "char-to",    "name": "device", "extradata": ";" },
    { "type": "literal",    "text": ";" },

    { "type": "char-to",    "name": "indicator", "extradata": ";" },
    { "type": "literal",    "text": ";" },

    { "type": "number",     "name": "state", "format": "number" },
    { "type": "literal",    "text": ";" } ]%

rule=nagios-ocsp:%[
    { "type": "char-sep",    "name": "output", "extradata": "|" },

    { "type": "rest" } ]%

prefix=%[
    { "type": "literal",    "text": "[" },
    { "type": "number",     "name": "datetime_reported", "format": "number" },
    { "type": "literal",    "text": "]" },
    { "type": "whitespace" },

    { "type": "literal",    "text": "PROCESS_HOST_CHECK_RESULT;" },

    { "type": "char-to",    "name": "device", "extradata": ";" },
    { "type": "literal",    "text": ";" },

    { "type": "number",     "name": "state", "format": "number" },
    { "type": "literal",    "text": ";" } ]%

rule=nagios-ochp:%[
    { "type": "char-sep",    "name": "output", "extradata": "|" },

    { "type": "rest" } ]%
