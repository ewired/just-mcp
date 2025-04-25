# Get the list of recipes from Just
just_recipes:
    just -l

# Get the list of recipes interpreted by just.ts
interpreted_recipes:
    unset ALLOWED_RECIPES && SHOW_RECIPES=1 deno run -A just.ts

# Test recipes for verifying MCP server functionality

# 1. Regular recipe without parameters
test_simple:
    echo "Simple recipe executed successfully"

# 2. Recipe with a required parameter
test_required_arg arg:
    echo "Required parameter received: {{arg}}"

# 3. Recipe with an optional parameter
test_optional_arg arg="default_value":
    echo "Optional parameter value: {{arg}}"

# 4. Recipe with multiple parameters
test_multiple_args first second="second_default":
    echo "First arg: {{first}}, Second arg: {{second}}"

# 5. Recipe with variable parameters
test_variable_args *ARGS:
    echo "Variable parameters received: {{ARGS}}"

# 6. Recipe with parameter required and optional variable parameters
test_variable_with_required arg *ARGS:
    echo "Given required arg: {{arg}}"
    echo "Rest of variable args: {{ARGS}}"

# 7. Recipe with at least one variable parameter required
test_minimum_variable +ARGS:
    echo "Given variable args: {{ARGS}}"

# 8. Recipe with a default variable parameter
test_minimum_variable_with_default +ARGS="default_arg":
    echo "Given variable args: {{ARGS}}"

# 9. Recipe with optional environment variable parameter
test_env_var $ENV_VAR="default_env":
    echo "Environment variable value: $ENV_VAR"

arch := "something"
# 10. Recipe with expressions as default parameter
test_expression_args triple=(arch + "-unknown-unknown") input=(arch / "input.dat"):
    echo "Triple is {{triple}} and input is {{input}}"

# 11. Recipe with expressions as default variadic parameter
test_variable_expression_args +ARGS=(arch + "-unknown-unknown"):
    echo "Given variable args: {{ARGS}}"